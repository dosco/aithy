import { Database } from "bun:sqlite";
import type { Job } from "bunqueue/client";
import type { AppConfig } from "../config/env";
import { captureProgramUsage } from "../usage/capture";
import type { SqliteUsageStore } from "../usage/usage-store";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/types";
import {
  createEmbeddedQueueWorker,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import { createSkillPromotionDrafter, draftMessage, type SkillPromotionDrafter } from "./promote-drafter";
import { detectRepeatPatterns, type DetectedPattern } from "./promote-detector";
import type { SqliteSkillPromotionStore } from "./promote-store";
import type { SqliteSkillsStore } from "./skills-store";

const CRON_PATTERN = "0 4 * * *"; // 04:00 daily, after the memory consolidator
type MaybePromise<T> = T | Promise<T>;

interface JobData {
  triggeredAt: string;
  taskId?: string;
}

export interface SkillPromoteQueueDeps {
  config: AppConfig;
  skills: SqliteSkillsStore;
  promotions: SqliteSkillPromotionStore;
  tasks?: SqliteTaskStore;
  onTaskStatus?: (task: TaskRecord) => void;
  postToSubSession: (input: {
    parentSessionId: string;
    parentMessageId?: number | null;
    text: string;
    name?: string;
    source?: string;
    notify?: boolean;
  }) => MaybePromise<{ sessionId: string; messageId: number | null }>;
  drafter?: SkillPromotionDrafter;
  usage?: SqliteUsageStore;
  notify: (input: {
    kind: "skill.suggested";
    title: string;
    body?: string | null;
    link?: string | null;
  }) => void;
  onQueueError?: QueueErrorReporter;
}

/**
 * Owns the daily skill-promotion cron. Detects tool-call patterns the user
 * runs repeatedly and surfaces a "save this as a skill?" notification.
 *
 * v2 drafts a candidate skill with the LLM, posts it into a sub-session, and
 * lets the user accept or dismiss by replying in that sub-session.
 */
export class SkillPromoteQueue {
  private readonly app: EmbeddedQueueWorker<JobData, { suggested: number }>;

  constructor(private readonly deps: SkillPromoteQueueDeps) {
    this.app = createEmbeddedQueueWorker<JobData, { suggested: number }>({
      name: "aithy.skill.promote",
      stateDbPath: deps.config.stateDbPath,
      processor: (job) => this.processJob(job),
      onError: deps.onQueueError,
    });
  }

  async schedule(): Promise<void> {
    await this.app.queue.upsertJobScheduler(
      "skill.promote.daily",
      { pattern: CRON_PATTERN },
      {
        name: "skill.promote.daily",
        data: { triggeredAt: new Date().toISOString() },
        opts: { attempts: 1 },
      },
    );
  }

  async runNow(): Promise<void> {
    const task = this.deps.tasks?.create({
      kind: "skill.promote",
      title: "Suggest reusable skills",
      conversationId: null,
      reason: "Queued for skill promotion",
    });
    if (task) this.deps.onTaskStatus?.(task);
    await this.app.queue.add(
      "skill.promote.now",
      { triggeredAt: new Date().toISOString(), ...(task ? { taskId: task.id } : {}) },
      {
        attempts: 1,
        deduplication: { id: "skill.promote:adhoc", ttl: 30_000 },
        jobId: `skill:promote:${crypto.randomUUID()}`,
      },
    );
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  private async processJob(job: Job<JobData>): Promise<{ suggested: number }> {
    const taskId = job.data.taskId ?? this.deps.tasks?.create({
      kind: "skill.promote",
      title: "Daily skill promotion",
      conversationId: null,
      reason: "Scheduled skill promotion",
    }).id;
    this.updateTask(taskId, {
      status: "running",
      queueJobId: String(job.id),
      reason: "Skill promotion is running",
    });
    try {
      const result = await this.process();
      this.updateTask(taskId, {
        status: "completed",
        reason: result.suggested > 0 ? "Skill suggestion ready" : "Skill promotion completed",
        resultSummary: `suggested ${result.suggested}`,
      });
      return result;
    } catch (error) {
      this.updateTask(taskId, {
        status: "failed",
        reason: "Skill promotion failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async process(): Promise<{ suggested: number }> {
    const db = new Database(this.deps.config.stateDbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 10000;");
    let patterns: DetectedPattern[] = [];
    try {
      patterns = detectRepeatPatterns(db);
    } finally {
      db.close();
    }

    const existing = new Set(this.deps.skills.getAll().map((s) => s.id));
    const drafter = this.deps.drafter ?? createSkillPromotionDrafter(this.deps.config);
    let suggested = 0;
    for (const pattern of patterns) {
      if (this.deps.promotions.hasSignature(pattern.signature)) continue;
      const candidateId = slugFromPattern(pattern);
      if (existing.has(candidateId)) continue;

      const draft = await drafter.forward({
        pattern,
        existingSkills: this.deps.skills.getAll(),
      });
      if (existing.has(draft.id)) continue;
      if (this.deps.usage) {
        captureProgramUsage(drafter.program, {
          store: this.deps.usage,
          purpose: "skill.promote",
          sessionId: pattern.sourceSessionId,
          runId: pattern.signature,
        });
      }
      const sub = await this.deps.postToSubSession({
        parentSessionId: pattern.sourceSessionId,
        parentMessageId: pattern.sourceMessageId,
        text: draftMessage({
          count: pattern.count,
          argsPreview: pattern.argsPreview,
          draft,
        }),
        name: `Skill suggestion: ${draft.name}`,
        source: "skill.promote",
        notify: false,
      });
      this.deps.promotions.createPending({
        signature: pattern.signature,
        subSessionId: sub.sessionId,
        sourceSessionId: pattern.sourceSessionId,
        sourceMessageId: pattern.sourceMessageId,
        toolName: pattern.toolName,
        argsPreview: pattern.argsPreview,
        count: pattern.count,
        firstSeenAt: pattern.firstSeenAt,
        lastSeenAt: pattern.lastSeenAt,
        draft,
      });
      this.deps.notify({
        kind: "skill.suggested",
        title: `Save "${draft.name}" as a skill?`,
        body: `You've used ${pattern.argsPreview} ${pattern.count} times in the last week. Open the suggestion and reply save or dismiss.`,
        link: `/chat/${sub.sessionId}`,
      });
      existing.add(draft.id);
      suggested += 1;
      // Don't drown the user — at most three suggestions per pass.
      if (suggested >= 3) break;
    }
    return { suggested };
  }

  private updateTask(taskId: string | undefined, patch: Parameters<SqliteTaskStore["update"]>[1]): void {
    if (!taskId || !this.deps.tasks) return;
    const task = this.deps.tasks.update(taskId, patch);
    if (task) this.deps.onTaskStatus?.(task);
  }
}

function slugFromPattern(p: DetectedPattern): string {
  return p.argsPreview
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
