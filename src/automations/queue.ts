import { type Job } from "bunqueue/client";
import type { AppConfig } from "../config/env";
import {
  createEmbeddedQueueWorker,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import type { UserChatJobData, UserChatQueueClient } from "../agent/dispatcher";
import type { NotificationCreate } from "../notifications/types";
import type { SessionManager } from "../session/session-manager";
import type { BotSessionSummary } from "../session/types";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/types";
import { serializableSession, type WebLiveEvent } from "../web/live-events";
import { automationRunPrompt } from "./prompt";
import { automationSchedulerId } from "./schedule";
import type { SqliteAutomationStore } from "./store";
import type { AutomationRecord, AutomationRunRecord } from "./types";

const QUEUE_NAME = "aithy.automations";
const ONCE_JOB_PREFIX = "automation:once:";

interface JobData {
  automationId: string;
  triggeredAt?: string;
  scheduledFor?: string;
  manual?: boolean;
}

interface AutomationQueueDeps {
  config: AppConfig;
  automations: SqliteAutomationStore;
  sessions: SessionManager;
  tasks: SqliteTaskStore;
  enqueueUserChat: UserChatQueueClient["enqueueUserChat"];
  onTaskStatus: (task: TaskRecord) => void;
  publishSessions: (sessions: BotSessionSummary[]) => void;
  flushSessionState?: () => Promise<void>;
  notify?: (input: NotificationCreate) => void;
  onQueueError?: QueueErrorReporter;
}

export class AutomationQueue {
  private readonly app: EmbeddedQueueWorker<JobData, { runId: string; skipped?: boolean }>;

  constructor(private readonly deps: AutomationQueueDeps) {
    this.app = createEmbeddedQueueWorker<JobData, { runId: string; skipped?: boolean }>({
      name: QUEUE_NAME,
      stateDbPath: deps.config.stateDbPath,
      processor: (job) => this.processJob(job),
      onError: deps.onQueueError,
    });
  }

  async syncSchedules(): Promise<void> {
    const active = this.deps.automations.active();
    const activeRecurringIds = new Set(
      active
        .filter((automation) => automation.schedule.kind !== "once")
        .map((automation) => automationSchedulerId(automation.id)),
    );
    const activeOnceIds = new Set(
      active
        .filter((automation) => automation.schedule.kind === "once")
        .map((automation) => onceJobId(automation.id)),
    );
    for (const scheduler of await this.app.queue.getJobSchedulers()) {
      if (scheduler.id.startsWith("automation:") && !activeRecurringIds.has(scheduler.id)) {
        await this.app.queue.removeJobScheduler(scheduler.id);
      }
    }
    await removeObsoleteOnceJobs(this.app.queue, activeOnceIds);
    for (const automation of active) await this.upsertSchedule(automation);
  }

  async runNow(automationId: string): Promise<void> {
    const automation = this.deps.automations.get(automationId);
    if (!automation || automation.status === "archived") {
      throw new Error(`Attention not runnable: ${automationId}`);
    }
    if (this.deps.automations.hasActiveRun(automationId)) {
      throw new Error(`Attention already has a queued or running look: ${automationId}`);
    }
    await this.app.queue.add(
      "automation.run.now",
      { automationId, triggeredAt: new Date().toISOString(), scheduledFor: new Date().toISOString(), manual: true },
      { attempts: 1, jobId: `automation:run:${automationId}:${crypto.randomUUID()}` },
    );
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  private async upsertSchedule(automation: AutomationRecord): Promise<void> {
    if (automation.schedule.kind === "once") {
      await this.upsertOnceSchedule(automation);
      return;
    }
    const repeat = automation.schedule.kind === "cron"
      ? {
          pattern: automation.schedule.pattern,
          timezone: automation.timezone,
          skipMissedOnRestart: Boolean(automation.schedule.skipMissed),
          preventOverlap: true,
        }
      : {
          every: automation.schedule.everyMs,
          skipMissedOnRestart: Boolean(automation.schedule.skipMissed),
          preventOverlap: true,
        };
    const info = await this.app.queue.upsertJobScheduler(
      automationSchedulerId(automation.id),
      repeat,
      {
        name: "automation.run",
        data: { automationId: automation.id },
        opts: { attempts: 1 },
      },
    );
    this.deps.automations.update(automation.id, {
      nextRunAt: info?.next ? new Date(info.next).toISOString() : null,
    });
  }

  private async upsertOnceSchedule(automation: AutomationRecord): Promise<void> {
    if (automation.schedule.kind !== "once") return;
    const id = onceJobId(automation.id);
    if (this.deps.automations.hasActiveRun(automation.id)) {
      this.deps.automations.update(automation.id, { nextRunAt: null });
      return;
    }
    await this.app.queue.removeAsync(id).catch(() => {});
    const runAt = new Date(automation.schedule.runAt);
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await this.app.queue.add(
      "automation.run.once",
      { automationId: automation.id, scheduledFor: runAt.toISOString() },
      { attempts: 1, jobId: id, delay },
    );
    this.deps.automations.update(automation.id, { nextRunAt: runAt.toISOString() });
  }

  private async processJob(job: Job<JobData>): Promise<{ runId: string; skipped?: boolean }> {
    const now = new Date();
    const automation = this.deps.automations.get(job.data.automationId);
    if (!automation || automation.status === "archived") return { runId: "skipped", skipped: true };
    if (!job.data.manual && automation.status !== "active") return { runId: "skipped", skipped: true };
    if (this.deps.automations.hasActiveRun(automation.id)) return { runId: "overlap", skipped: true };
    const run = this.deps.automations.createRun({
      automationId: automation.id,
      triggeredAt: job.data.triggeredAt ?? now.toISOString(),
      scheduledFor: job.data.scheduledFor ?? now.toISOString(),
    });
    try {
      await this.enqueueAgentRun(automation, run, now);
      await this.updateNextRun(automation.id);
      return { runId: run.id };
    } catch (error) {
      this.deps.automations.updateRun(run.id, {
        status: "failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      this.deps.automations.update(automation.id, { status: "needs_input", lastRunAt: run.triggeredAt });
      this.deps.notify?.({
        kind: "automation.failed",
        title: `Attention failed: ${automation.title}`,
        body: error instanceof Error ? error.message : String(error),
        link: `/chat/${automation.originSessionId}`,
      });
      throw error;
    }
  }

  private async enqueueAgentRun(
    automation: AutomationRecord,
    run: AutomationRunRecord,
    now: Date,
  ): Promise<void> {
    const child = this.deps.sessions.createSubSession({
      parentSessionId: automation.originSessionId,
      name: runSessionName(automation, now),
      source: "automation",
    });
    const text = automationRunPrompt({
      automation,
      run,
      recentRuns: this.deps.automations.recentRuns(automation.id, 6),
      now,
    });
    const createdAt = now.toISOString();
    this.deps.sessions.appendMessages(child.conversationId, [{ role: "user", content: text, createdAt }]);
    await this.deps.flushSessionState?.();
    this.deps.publishSessions(this.deps.sessions.listSessions());

    const task = this.deps.tasks.create({
      kind: "chat.turn",
      title: `Attention: ${automation.title}`,
      conversationId: child.conversationId,
      relatedSessionId: child.conversationId,
      reason: "Queued scheduled attention",
      metadata: { text, skillIds: [], automationId: automation.id, automationRunId: run.id, scheduled: true },
    });
    this.deps.onTaskStatus(task);
    this.deps.automations.updateRun(run.id, {
      runSessionId: child.conversationId,
      taskId: task.id,
      status: "queued",
    });
    const data: UserChatJobData = {
      conversationId: child.conversationId,
      text,
      createdAt,
      skillIds: [],
      taskId: task.id,
      automationId: automation.id,
      automationRunId: run.id,
    };
    const queued = await this.deps.enqueueUserChat(data);
    const linked = this.deps.tasks.update(task.id, { queueJobId: queued.jobId, reason: "Queued scheduled attention" });
    if (linked) this.deps.onTaskStatus(linked);
  }

  private async updateNextRun(automationId: string): Promise<void> {
    const automation = this.deps.automations.get(automationId);
    if (automation?.schedule.kind === "once") {
      this.deps.automations.update(automationId, {
        nextRunAt: null,
        lastRunAt: new Date().toISOString(),
      });
      return;
    }
    const info = await this.app.queue.getJobScheduler(automationSchedulerId(automationId));
    this.deps.automations.update(automationId, {
      nextRunAt: info?.next ? new Date(info.next).toISOString() : null,
      lastRunAt: new Date().toISOString(),
    });
  }
}

async function removeObsoleteOnceJobs(
  queue: {
    getJobsAsync(input: {
      state: string[];
      start: number;
      end: number;
      asc: boolean;
    }): Promise<Array<{ id?: string | number }>>;
    removeAsync(id: string): Promise<void>;
  },
  activeOnceIds: Set<string>,
): Promise<void> {
  const jobs = await queue.getJobsAsync({
    state: ["waiting", "delayed", "prioritized"],
    start: 0,
    end: 1000,
    asc: true,
  });
  for (const job of jobs) {
    const id = String(job.id);
    if (id.startsWith(ONCE_JOB_PREFIX) && !activeOnceIds.has(id)) {
      await queue.removeAsync(id).catch(() => {});
    }
  }
}

export function sessionsEvent(sessions: BotSessionSummary[]): WebLiveEvent {
  return {
    type: "sessions",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sessions: sessions.map(serializableSession),
  };
}

function runSessionName(automation: AutomationRecord, now: Date): string {
  const stamp = now.toLocaleString(undefined, {
    timeZone: automation.timezone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${automation.title} - ${stamp}`;
}

function onceJobId(automationId: string): string {
  return `${ONCE_JOB_PREFIX}${automationId}`;
}
