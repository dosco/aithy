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
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage } from "../usage/capture";
import { detectionToUpsert, createDreamDetector, type DreamDetector } from "./dream-detector";
import type { SqliteEpisodeStore } from "./episode-store";

export const DREAM_BATCH_DELAY_MS = 5 * 60_000;
export const DREAM_DEDUP_TTL_MS = 10 * 60_000;
const MAX_MESSAGES_PER_RUN = 200;
const OVERLAP_MESSAGES_PER_SESSION = 20;
const CRON_PATTERN = "15 3 * * *"; // every day at 03:15 local time
const AUTO_DEDUP_ID = "memory-dream:auto";
const ADHOC_DEDUP_ID = "memory-dream:adhoc";

type MaybePromise<T> = T | Promise<T>;

interface JobData {
  triggeredAt: string;
  sourceSessionId?: string;
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
}

export interface DreamQueueDeps {
  config: AppConfig;
  episodes: SqliteEpisodeStore;
  tasks?: SqliteTaskStore;
  usage?: SqliteUsageStore;
  onTaskStatus?: (task: TaskRecord) => void;
  detector?: DreamDetector;
  onQueueError?: QueueErrorReporter;
}

export class DreamQueue {
  private readonly app: EmbeddedQueueWorker<JobData, { inspected: number; episodes: number; failed: number }>;

  constructor(private readonly deps: DreamQueueDeps) {
    this.app = createEmbeddedQueueWorker<JobData, { inspected: number; episodes: number; failed: number }>({
      name: "aithy.memory.dreams",
      stateDbPath: deps.config.stateDbPath,
      processor: (job) => this.processJob(job),
      onError: deps.onQueueError,
    });
  }

  async schedule(): Promise<void> {
    await this.app.queue.upsertJobScheduler(
      "memory.dream.nightly",
      { pattern: CRON_PATTERN },
      {
        name: "memory.dream.nightly",
        data: { triggeredAt: new Date().toISOString() },
        opts: { attempts: 1 },
      },
    );
  }

  async enqueueAuto(sourceSessionId: string): Promise<void> {
    const planned = this.deps.tasks?.createOrReusePlanned({
      dedupeKey: AUTO_DEDUP_ID,
      create: {
        kind: "memory.dream",
        title: "Dream over recent work",
        conversationId: sourceSessionId,
        relatedSessionId: sourceSessionId,
        reason: "Queued for episodic memory extraction",
        metadata: { sourceSessionId },
      },
      update: {
        conversationId: sourceSessionId,
        relatedSessionId: sourceSessionId,
        reason: "Queued for episodic memory extraction",
        metadata: { sourceSessionId },
      },
    });
    if (planned) this.deps.onTaskStatus?.(planned.task);
    const task = planned?.task;
    try {
      await this.app.queue.add(
        "memory.dream.auto",
        { triggeredAt: new Date().toISOString(), sourceSessionId, ...(task ? { taskId: task.id } : {}) },
        {
          attempts: 1,
          delay: DREAM_BATCH_DELAY_MS,
          deduplication: {
            id: AUTO_DEDUP_ID,
            ttl: DREAM_DEDUP_TTL_MS,
            extend: true,
            replace: true,
          },
          jobId: `memory:dream:${crypto.randomUUID()}`,
        },
      );
    } catch (error) {
      if (isDuplicateJobWriteError(error)) {
        if (task && !planned?.reused) {
          const cancelled = this.deps.tasks?.update(task.id, {
            status: "cancelled",
            reason: "Duplicate dream task was already queued",
          });
          if (cancelled) this.deps.onTaskStatus?.(cancelled);
        }
        this.deps.onQueueError?.("[aithy.memory.dreams] duplicate auto job ignored", error as Error);
        return;
      }
      this.failQueuedTask(planned?.reused ? undefined : task?.id, "Could not queue dream task", error);
      throw error;
    }
  }

  async runNow(): Promise<void> {
    const planned = this.deps.tasks?.createOrReusePlanned({
      dedupeKey: ADHOC_DEDUP_ID,
      create: {
        kind: "memory.dream",
        title: "Dream over recent work",
        conversationId: null,
        reason: "Queued for episodic memory extraction",
      },
      update: {
        reason: "Queued for episodic memory extraction",
      },
    });
    if (planned) this.deps.onTaskStatus?.(planned.task);
    const task = planned?.task;
    try {
      await this.app.queue.add(
        "memory.dream.now",
        { triggeredAt: new Date().toISOString(), ...(task ? { taskId: task.id } : {}) },
        {
          attempts: 1,
          deduplication: { id: ADHOC_DEDUP_ID, ttl: 30_000 },
          jobId: `memory:dream:${crypto.randomUUID()}`,
        },
      );
    } catch (error) {
      if (isDuplicateJobWriteError(error)) {
        if (task && !planned?.reused) {
          const cancelled = this.deps.tasks?.update(task.id, {
            status: "cancelled",
            reason: "Duplicate dream task was already queued",
          });
          if (cancelled) this.deps.onTaskStatus?.(cancelled);
        }
        this.deps.onQueueError?.("[aithy.memory.dreams] duplicate adhoc job ignored", error as Error);
        return;
      }
      this.failQueuedTask(planned?.reused ? undefined : task?.id, "Could not queue dream task", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  updateConfig(config: AppConfig): void {
    this.deps.config = config;
  }

  private async processJob(job: Job<JobData>): Promise<{ inspected: number; episodes: number; failed: number }> {
    const taskId = job.data.taskId ?? this.createScheduledTask();
    this.updateTask(taskId, {
      status: "running",
      queueJobId: String(job.id),
      reason: "Dream processing is running",
    });
    try {
      const result = await this.process(job.data);
      this.updateTask(taskId, {
        status: "completed",
        reason: result.episodes > 0 ? "Dream episodes saved" : "Dream processing completed",
        resultSummary: `inspected ${result.inspected}, episodes ${result.episodes}, failed ${result.failed}`,
      });
      return result;
    } catch (error) {
      this.updateTask(taskId, {
        status: "failed",
        reason: "Dream processing failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async process(_data: JobData): Promise<{ inspected: number; episodes: number; failed: number }> {
    const startCursor = this.deps.episodes.cursor();
    const db = new Database(this.deps.config.stateDbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 10000;");
    let batch: MessageRow[] = [];
    try {
      batch = fetchMessagesAfter(db, startCursor, MAX_MESSAGES_PER_RUN);
    } finally {
      db.close();
    }

    if (batch.length === 0) return { inspected: 0, episodes: 0, failed: 0 };
    const maxMessageId = Math.max(...batch.map((row) => row.id));
    let stored = 0;
    let failed = 0;
    try {
      const topLevel = batch.filter((row) => row.parent_session_id === null);
      const bySession = groupBySession(topLevel);
      for (const [sessionId, rows] of bySession) {
        if (!shouldInspectDreamSegment(rows)) continue;
        try {
          stored += await this.inspectSessionSegment(sessionId, rows);
        } catch (error) {
          failed += 1;
          this.deps.onQueueError?.(
            `[aithy.memory.dreams] failed to inspect session ${sessionId}`,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    } finally {
      this.deps.episodes.setCursor(maxMessageId);
    }
    return { inspected: batch.length, episodes: stored, failed };
  }

  private async inspectSessionSegment(sessionId: string, newRows: MessageRow[]): Promise<number> {
    const db = new Database(this.deps.config.stateDbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 10000;");
    let overlap: MessageRow[] = [];
    try {
      overlap = fetchOverlap(db, sessionId, newRows[0].id, OVERLAP_MESSAGES_PER_SESSION);
    } finally {
      db.close();
    }

    const detector = this.deps.detector ?? createDreamDetector(this.deps.config);
    const transcript = formatTranscript(overlap, newRows);
    const detections = await detector.forward({ transcript });
    if (this.deps.usage) {
      captureProgramUsage(detector.program, {
        store: this.deps.usage,
        purpose: "memory.dream",
        sessionId,
      });
    }

    const evidenceIds = new Set([...overlap, ...newRows].map((row) => row.id));
    const fallbackStart = newRows[0].id;
    const fallbackEnd = newRows.at(-1)!.id;
    let stored = 0;
    for (const detection of detections) {
      this.deps.episodes.upsert(detectionToUpsert(
        detection,
        sessionId,
        fallbackStart,
        fallbackEnd,
        evidenceIds,
      ));
      stored += 1;
    }
    return stored;
  }

  private createScheduledTask(): string | undefined {
    const task = this.deps.tasks?.create({
      kind: "memory.dream",
      title: "Nightly dream processing",
      conversationId: null,
      reason: "Scheduled episodic memory extraction",
    });
    if (task) this.deps.onTaskStatus?.(task);
    return task?.id;
  }

  private failQueuedTask(taskId: string | undefined, reason: string, error: unknown): void {
    const failed = taskId
      ? this.deps.tasks?.update(taskId, {
          status: "failed",
          reason,
          errorSummary: error instanceof Error ? error.message : String(error),
        })
      : null;
    if (failed) this.deps.onTaskStatus?.(failed);
  }

  private updateTask(taskId: string | undefined, patch: Parameters<SqliteTaskStore["update"]>[1]): void {
    if (!taskId || !this.deps.tasks) return;
    const task = this.deps.tasks.update(taskId, patch);
    if (task) this.deps.onTaskStatus?.(task);
  }
}

export function shouldInspectDreamSegment(rows: readonly MessageRow[]): boolean {
  if (rows.length === 0) return false;
  if (rows.some((row) => row.tool_name || row.message_kind === "artifact")) return true;
  const text = rows.map((row) => row.content ?? "").join("\n");
  if (!rows.some((row) => row.role === "assistant" && row.content)) return false;
  return /\b(fix|implement|debug|test|build|created|updated|failed|error|artifact|file|workflow|run|ran|search|analy[sz]e|investigate|memory|skill)\b/i.test(text);
}

function fetchMessagesAfter(db: Database, cursor: number, limit: number): MessageRow[] {
  return db
    .query(
      `SELECT m.id, m.session_id, m.role, m.message_kind, m.content, m.tool_name,
              m.tool_args, m.tool_result, m.created_at, s.parent_session_id
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
              m.tool_args, m.tool_result, m.created_at, s.parent_session_id
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
  const prefix = `[${kind} #${row.id} ${row.created_at}]`;
  if (row.tool_name) {
    return `${prefix} tool ${row.tool_name}: args=${compactJson(row.tool_args)} result=${compactJson(row.tool_result)}`;
  }
  if (row.message_kind === "artifact") return `${prefix} artifact: ${compact(row.content ?? "")}`;
  const role = row.role === "assistant" || row.role === "user" ? row.role : "message";
  return `${prefix} ${role}: ${compact(row.content ?? "")}`;
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

export type { JobData as DreamJobData, MessageRow as DreamMessageRow };
