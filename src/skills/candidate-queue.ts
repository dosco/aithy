import { Database } from "bun:sqlite";
import type { Job } from "bunqueue/client";
import type { AppConfig } from "../config/env";
import {
  createEmbeddedQueueWorker,
  isDuplicateJobWriteError,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/types";
import type { SkillCandidateEntry } from "./candidate-store";
import { SqliteSkillCandidateStore } from "./candidate-store";
import {
  createSkillCandidateDetector,
  type SkillCandidateDetection,
  type SkillCandidateDetector,
} from "./candidate-detector";

export const SKILL_CANDIDATE_BATCH_DELAY_MS = 5 * 60_000;
export const SKILL_CANDIDATE_DEDUP_TTL_MS = 10 * 60_000;
const SKILL_CANDIDATE_DEDUP_ID = "skill-candidates:auto";
const SKILL_CANDIDATE_ADHOC_DEDUP_ID = "skill-candidates:adhoc";
const MAX_MESSAGES_PER_RUN = 200;
const OVERLAP_MESSAGES_PER_SESSION = 20;
const SUGGESTION_CONFIDENCE = 0.7;
const MAX_SUGGESTIONS_PER_RUN = 3;

type MaybePromise<T> = T | Promise<T>;

interface JobData {
  triggeredAt: string;
  taskId?: string;
}

interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  message_kind: string | null;
  content: string | null;
  tool_name: string | null;
  tool_args: string | null;
  tool_result: string | null;
  created_at: string;
  parent_session_id: string | null;
  source: string;
}

export interface SkillCandidateQueueDeps {
  config: AppConfig;
  candidates: SqliteSkillCandidateStore;
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
  detector?: SkillCandidateDetector;
  notify: (input: {
    kind: "skill.suggested";
    title: string;
    body?: string | null;
    link?: string | null;
  }) => void;
  onQueueError?: QueueErrorReporter;
}

export class SkillCandidateQueue {
  private readonly app: EmbeddedQueueWorker<JobData, { inspected: number; candidates: number; suggested: number }>;

  constructor(private readonly deps: SkillCandidateQueueDeps) {
    this.app = createEmbeddedQueueWorker<JobData, { inspected: number; candidates: number; suggested: number }>({
      name: "aithy.skill.candidates",
      stateDbPath: deps.config.stateDbPath,
      processor: (job) => this.processJob(job),
      onError: deps.onQueueError,
    });
  }

  async enqueueAuto(): Promise<void> {
    const planned = this.deps.tasks?.createOrReusePlanned({
      dedupeKey: SKILL_CANDIDATE_DEDUP_ID,
      create: {
        kind: "skill.candidate",
        title: "Look for reusable skill ideas",
        conversationId: null,
        reason: "Queued for skill idea detection",
      },
      update: {
        reason: "Queued for skill idea detection",
      },
    });
    if (planned) this.deps.onTaskStatus?.(planned.task);
    const task = planned?.task;
    try {
      await this.app.queue.add(
        "skill.candidates.auto",
        { triggeredAt: new Date().toISOString(), ...(task ? { taskId: task.id } : {}) },
        {
          attempts: 1,
          delay: SKILL_CANDIDATE_BATCH_DELAY_MS,
          deduplication: {
            id: SKILL_CANDIDATE_DEDUP_ID,
            ttl: SKILL_CANDIDATE_DEDUP_TTL_MS,
            extend: true,
            replace: true,
          },
          jobId: `skill:candidates:${crypto.randomUUID()}`,
        },
      );
    } catch (error) {
      if (isDuplicateJobWriteError(error)) {
        if (task && !planned?.reused) {
          const cancelled = this.deps.tasks?.update(task.id, {
            status: "cancelled",
            reason: "Duplicate skill idea task was already queued",
          });
          if (cancelled) this.deps.onTaskStatus?.(cancelled);
        }
        this.deps.onQueueError?.("[aithy.skill.candidates] duplicate auto job ignored", error as Error);
        return;
      }
      if (task && !planned?.reused) {
        const failed = this.deps.tasks?.update(task.id, {
          status: "failed",
          reason: "Could not queue skill idea task",
          errorSummary: error instanceof Error ? error.message : String(error),
        });
        if (failed) this.deps.onTaskStatus?.(failed);
      }
      throw error;
    }
  }

  async runNow(): Promise<void> {
    const planned = this.deps.tasks?.createOrReusePlanned({
      dedupeKey: SKILL_CANDIDATE_ADHOC_DEDUP_ID,
      create: {
        kind: "skill.candidate",
        title: "Look for reusable skill ideas",
        conversationId: null,
        reason: "Queued for skill idea detection",
      },
      update: {
        reason: "Queued for skill idea detection",
      },
    });
    if (planned) this.deps.onTaskStatus?.(planned.task);
    const task = planned?.task;
    try {
      await this.app.queue.add(
        "skill.candidates.now",
        { triggeredAt: new Date().toISOString(), ...(task ? { taskId: task.id } : {}) },
        {
          attempts: 1,
          deduplication: { id: SKILL_CANDIDATE_ADHOC_DEDUP_ID, ttl: 30_000 },
          jobId: `skill:candidates:${crypto.randomUUID()}`,
        },
      );
    } catch (error) {
      if (isDuplicateJobWriteError(error)) {
        if (task && !planned?.reused) {
          const cancelled = this.deps.tasks?.update(task.id, {
            status: "cancelled",
            reason: "Duplicate skill idea task was already queued",
          });
          if (cancelled) this.deps.onTaskStatus?.(cancelled);
        }
        this.deps.onQueueError?.("[aithy.skill.candidates] duplicate adhoc job ignored", error as Error);
        return;
      }
      if (task && !planned?.reused) {
        const failed = this.deps.tasks?.update(task.id, {
          status: "failed",
          reason: "Could not queue skill idea task",
          errorSummary: error instanceof Error ? error.message : String(error),
        });
        if (failed) this.deps.onTaskStatus?.(failed);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  updateConfig(config: AppConfig): void {
    this.deps.config = config;
  }

  private async processJob(job: Job<JobData>): Promise<{ inspected: number; candidates: number; suggested: number }> {
    try {
      return await this.process(job.data);
    } catch (error) {
      this.updateTask(job.data.taskId, {
        status: "failed",
        reason: "Skill idea detection failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async process(data: JobData): Promise<{ inspected: number; candidates: number; suggested: number }> {
    this.updateTask(data.taskId, {
      status: "running",
      reason: "Skill idea detection is running",
    });
    const startCursor = this.deps.candidates.cursor();
    const db = new Database(this.deps.config.stateDbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 10000;");
    let batch: MessageRow[] = [];
    try {
      batch = fetchMessagesAfter(db, startCursor, MAX_MESSAGES_PER_RUN);
    } finally {
      db.close();
    }
    if (batch.length === 0) {
      const result = { inspected: 0, candidates: 0, suggested: 0 };
      this.updateTask(data.taskId, {
        status: "completed",
        reason: "No new skill ideas to inspect",
        resultSummary: "No new messages",
      });
      return result;
    }

    const maxMessageId = Math.max(...batch.map((row) => row.id));
    let stored = 0;
    let suggested = 0;
    try {
      const topLevel = batch.filter((row) => row.parent_session_id === null);
      const bySession = groupBySession(topLevel);
      for (const [sessionId, rows] of bySession) {
        if (!shouldInspectSkillSegment(rows)) continue;
        try {
          const result = await this.inspectSessionSegment(sessionId, rows, suggested);
          stored += result.stored;
          suggested += result.suggested;
        } catch (error) {
          this.deps.onQueueError?.(
            `[aithy.skill.candidates] failed to inspect session ${sessionId}`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    } finally {
      this.deps.candidates.setCursor(maxMessageId);
    }

    const result = { inspected: batch.length, candidates: stored, suggested };
    this.updateTask(data.taskId, {
      status: "completed",
      reason: suggested > 0 ? "Skill suggestion ready" : "Skill idea detection completed",
      resultSummary: `inspected ${result.inspected}, candidates ${result.candidates}, suggested ${result.suggested}`,
    });
    return result;
  }

  private async inspectSessionSegment(
    sessionId: string,
    newRows: MessageRow[],
    alreadySuggested: number,
  ): Promise<{ stored: number; suggested: number }> {
    const db = new Database(this.deps.config.stateDbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 10000;");
    let overlap: MessageRow[] = [];
    try {
      overlap = fetchOverlap(db, sessionId, newRows[0].id, OVERLAP_MESSAGES_PER_SESSION);
    } finally {
      db.close();
    }

    const openCandidates = this.deps.candidates.openBySession(sessionId);
    const detector = this.deps.detector ?? createSkillCandidateDetector(this.deps.config);
    const transcript = formatTranscript(overlap, newRows);
    const detections = await detector.forward({ openCandidates, transcript });
    let stored = 0;
    let suggested = 0;
    const evidenceIds = new Set([...overlap, ...newRows].map((row) => row.id));
    const fallbackStart = newRows[0].id;
    const fallbackEnd = newRows.at(-1)!.id;

    for (const detection of detections) {
      const entry = this.deps.candidates.upsertCandidate({
        existingId: existingId(openCandidates, detection),
        title: detection.title,
        description: detection.description || detection.title,
        canonicalText: detection.canonicalText || detection.title,
        rationale: detection.rationale,
        confidence: detection.confidence,
        tags: detection.tags,
        sourceSessionId: sessionId,
        evidenceStartMessageId: validEvidenceId(evidenceIds, detection.evidenceStartMessageId) ?? fallbackStart,
        evidenceEndMessageId: validEvidenceId(evidenceIds, detection.evidenceEndMessageId) ?? fallbackEnd,
      });
      stored += 1;
      if (alreadySuggested + suggested >= MAX_SUGGESTIONS_PER_RUN) continue;
      if (entry.status !== "developing" || entry.confidence < SUGGESTION_CONFIDENCE) continue;
      await this.suggest(entry);
      suggested += 1;
    }

    return { stored, suggested };
  }

  private async suggest(candidate: SkillCandidateEntry): Promise<void> {
    const sub = await this.deps.postToSubSession({
      parentSessionId: candidate.sourceSessionId,
      parentMessageId: candidate.evidenceEndMessageId,
      text: suggestionMessage(candidate),
      name: `Skill idea: ${candidate.title}`,
      source: "skill.candidates",
      notify: false,
    });
    const suggested = this.deps.candidates.markSuggested(candidate.id, sub.sessionId) ?? candidate;
    this.deps.notify({
      kind: "skill.suggested",
      title: `Create a skill for "${suggested.title}"?`,
      body: suggested.description,
      link: `/chat/${sub.sessionId}`,
    });
  }

  private updateTask(taskId: string | undefined, patch: Parameters<SqliteTaskStore["update"]>[1]): void {
    if (!taskId || !this.deps.tasks) return;
    const task = this.deps.tasks.update(taskId, patch);
    if (task) this.deps.onTaskStatus?.(task);
  }
}

export function shouldInspectSkillSegment(rows: readonly MessageRow[]): boolean {
  if (rows.length === 0) return false;
  const text = rows.map((row) => row.content ?? "").join("\n");
  if (rows.some((row) => row.tool_name)) return true;
  if (/\b(again|usually|always|next time|reusable|skill|workflow|normal flow|same flow|procedure|checklist)\b/i.test(text)) {
    return true;
  }
  const assistantSteps = rows.filter((row) =>
    row.role === "assistant"
    && row.content
    && /(^|\n)\s*(\d+\.|-|\*)\s+\S/.test(row.content)
  );
  return assistantSteps.length > 0;
}

function fetchMessagesAfter(db: Database, cursor: number, limit: number): MessageRow[] {
  return db
    .query(
      `SELECT m.id, m.session_id, m.role, m.message_kind, m.content, m.tool_name,
              m.tool_args, m.tool_result, m.created_at, s.parent_session_id, s.source
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.id > $cursor
       ORDER BY m.id ASC
       LIMIT $limit`,
    )
    .all({ $cursor: cursor, $limit: limit }) as MessageRow[];
}

function fetchOverlap(db: Database, sessionId: string, beforeId: number, limit: number): MessageRow[] {
  const rows = db
    .query(
      `SELECT m.id, m.session_id, m.role, m.message_kind, m.content, m.tool_name,
              m.tool_args, m.tool_result, m.created_at, s.parent_session_id, s.source
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.session_id = $sessionId AND m.id < $beforeId
       ORDER BY m.id DESC
       LIMIT $limit`,
    )
    .all({ $sessionId: sessionId, $beforeId: beforeId, $limit: limit }) as MessageRow[];
  return rows.reverse();
}

function groupBySession(rows: readonly MessageRow[]): Map<string, MessageRow[]> {
  const grouped = new Map<string, MessageRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.session_id);
    if (existing) existing.push(row);
    else grouped.set(row.session_id, [row]);
  }
  return grouped;
}

function formatTranscript(overlap: readonly MessageRow[], newRows: readonly MessageRow[]): string {
  const parts: string[] = [];
  for (const row of overlap) parts.push(formatRow(row, "context"));
  for (const row of newRows) parts.push(formatRow(row, "new"));
  return parts.join("\n");
}

function formatRow(row: MessageRow, kind: "context" | "new"): string {
  if (row.tool_name) {
    return `[${kind} #${row.id} ${row.created_at}] tool ${row.tool_name}: ${compactJson(row.tool_args)}`;
  }
  const role = row.role === "assistant" ? "assistant" : row.role === "user" ? "user" : row.role;
  return `[${kind} #${row.id} ${row.created_at}] ${role}: ${compact(row.content ?? "")}`;
}

function suggestionMessage(candidate: SkillCandidateEntry): string {
  return [
    `I noticed this looks reusable: ${candidate.title}.`,
    "",
    candidate.description,
    "",
    "Reply `save`, `accept`, or `yes` and I'll create a skill for it. Reply `dismiss` or `no` to ignore it.",
  ].join("\n");
}

function existingId(openCandidates: readonly SkillCandidateEntry[], detection: SkillCandidateDetection): string | null {
  if (!detection.existingCandidateId) return null;
  return openCandidates.some((candidate) => candidate.id === detection.existingCandidateId)
    ? detection.existingCandidateId
    : null;
}

function validEvidenceId(ids: Set<number>, value: number | null): number | null {
  return value !== null && ids.has(value) ? value : null;
}

function compactJson(raw: string | null): string {
  if (!raw) return "null";
  try {
    return compact(JSON.stringify(JSON.parse(raw)));
  } catch {
    return compact(raw);
  }
}

function compact(text: string, max = 1_500): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)} [truncated]` : cleaned;
}
