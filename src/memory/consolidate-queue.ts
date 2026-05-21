import { Queue, type Job } from "bunqueue/client";
import type { AppConfig } from "../config/env";
import {
  bunqueueDataPath,
  createEmbeddedQueueWorker,
  isDuplicateJobWriteError,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import { createConsolidatorAgent, formatStoreForConsolidator } from "./consolidator-agent";
import type { SqliteMemoryStore } from "./memory-store";
import type { SqliteMemoryRunsStore } from "./memory-runs";
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage, usageAttributionForConfig } from "../usage/capture";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/types";
import type { RuntimeStore } from "../runtime/runtime-store";

const MAX_ATTEMPTS = 2;
const JOB_TTL_MS = 5 * 60_000;
const CRON_PATTERN = "0 3 * * *"; // every day at 03:00 local time
const ADHOC_DEDUP_ID = "consolidate:adhoc";

interface JobData {
  runId: string;
  triggeredAt: string;
  taskId?: string;
}

export interface MemoryConsolidateHandle {
  runNow(): Promise<void>;
  close(): Promise<void>;
}

export class MemoryConsolidateProducer implements MemoryConsolidateHandle {
  private readonly queue: Queue<JobData>;

  constructor(stateDbPath: string) {
    this.queue = new Queue<JobData>("aithy.memory.consolidate", {
      embedded: true,
      dataPath: bunqueueDataPath(stateDbPath),
    });
  }

  async runNow(): Promise<void> {
    const runId = crypto.randomUUID();
    await this.queue.add(
      "memory.consolidate.now",
      { runId, triggeredAt: new Date().toISOString() },
      {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 30_000 },
        deduplication: { id: ADHOC_DEDUP_ID, ttl: 30_000 },
        jobId: `memory:consolidate:${runId}`,
      },
    );
  }

  async close(): Promise<void> {
    this.queue.close();
  }
}

export interface ConsolidateQueueDeps {
  config: AppConfig;
  memory: SqliteMemoryStore;
  runs: SqliteMemoryRunsStore;
  runtimeStore?: RuntimeStore;
  tasks?: SqliteTaskStore;
  onTaskStatus?: (task: TaskRecord) => void;
  usage?: SqliteUsageStore;
  notify?: (input: {
    kind: "memory.consolidated";
    title: string;
    body?: string | null;
    link?: string | null;
  }) => void;
  onQueueError?: QueueErrorReporter;
}

/**
 * Owns the nightly memory consolidation cron. Runs the consolidator agent
 * over the entire active memory store; the agent decides what to merge,
 * supersede, or prune.
 */
export class MemoryConsolidateQueue implements MemoryConsolidateHandle {
  private readonly app: EmbeddedQueueWorker<JobData, { summary: string }>;

  constructor(private readonly deps: ConsolidateQueueDeps) {
    this.app = createEmbeddedQueueWorker<JobData, { summary: string }>({
      name: "aithy.memory.consolidate",
      stateDbPath: deps.config.stateDbPath,
      processor: (job) => this.processJob(job),
      onError: deps.onQueueError,
    });
  }

  /** Schedule the nightly cron. Idempotent — bunqueue dedupes by id. */
  async schedule(): Promise<void> {
    await this.app.queue.upsertJobScheduler(
      "memory.consolidate.nightly",
      { pattern: CRON_PATTERN },
      {
        name: "memory.consolidate.nightly",
        data: { runId: "scheduled", triggeredAt: new Date().toISOString() },
        opts: {
          attempts: MAX_ATTEMPTS,
          backoff: { type: "exponential", delay: 30_000 },
        },
      },
    );
  }

  /** Trigger an immediate consolidation pass (e.g. from a UI button). */
  async runNow(): Promise<void> {
    const runId = crypto.randomUUID();
    const planned = this.deps.tasks?.createOrReusePlanned({
      dedupeKey: ADHOC_DEDUP_ID,
      create: {
        kind: "memory.consolidate",
        title: "Consolidate memories",
        conversationId: null,
        reason: "Queued for memory consolidation",
      },
      update: {
        reason: "Queued for memory consolidation",
      },
    });
    if (planned) this.deps.onTaskStatus?.(planned.task);
    const task = planned?.task;
    try {
      await this.app.queue.add(
        "memory.consolidate.now",
        { runId, triggeredAt: new Date().toISOString(), ...(task ? { taskId: task.id } : {}) },
        {
          attempts: MAX_ATTEMPTS,
          backoff: { type: "exponential", delay: 30_000 },
          deduplication: { id: ADHOC_DEDUP_ID, ttl: 30_000 },
          jobId: `memory:consolidate:${runId}`,
        },
      );
    } catch (error) {
      if (isDuplicateJobWriteError(error)) {
        if (task && !planned?.reused) {
          this.updateTask(task.id, {
            status: "cancelled",
            reason: "Duplicate memory consolidation task was already queued",
          });
        }
        this.deps.onQueueError?.("[aithy.memory.consolidate] duplicate adhoc job ignored", error as Error);
        return;
      }
      if (task && !planned?.reused) {
        this.updateTask(task.id, {
          status: "failed",
          reason: "Could not queue memory consolidation",
          errorSummary: error instanceof Error ? error.message : String(error),
        });
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

  private async processJob(job: Job<JobData>): Promise<{ summary: string }> {
    const taskId = job.data.taskId ?? (job.data.runId === "scheduled"
      ? this.deps.tasks?.create({
          kind: "memory.consolidate",
          title: "Nightly memory consolidation",
          conversationId: null,
          reason: "Scheduled memory consolidation",
        }).id
      : undefined);
    if (taskId) {
      const task = this.deps.tasks?.update(taskId, {
        status: "running",
        queueJobId: String(job.id),
        reason: "Memory consolidation is running",
      });
      if (task) this.deps.onTaskStatus?.(task);
    }
    if (Date.now() - job.timestamp > JOB_TTL_MS) {
      this.updateTask(taskId, { status: "cancelled", reason: "Memory consolidation expired before it could run" });
      return { summary: "job expired" };
    }
    try {
      const result = await this.process(job.data);
      this.updateTask(taskId, {
        status: "completed",
        reason: "Memory consolidation completed",
        resultSummary: result.summary,
      });
      return result;
    } catch (error) {
      this.updateTask(taskId, {
        status: "failed",
        reason: "Memory consolidation failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async process(data: JobData): Promise<{ summary: string }> {
    const runId = data.runId === "scheduled" ? crypto.randomUUID() : data.runId;
    this.deps.runs.recordStart({
      id: runId,
      sessionId: "system",
      trigger: "consolidate",
    });

    const all = this.deps.memory.recent(500);
    if (all.length < 3) {
      const summary = "store too small to consolidate";
      this.deps.runs.recordComplete(runId, summary);
      return { summary };
    }

    const before = this.deps.memory.rawCount();
    const agent = createConsolidatorAgent({
      config: this.deps.config,
      runtimeStore: this.deps.runtimeStore,
      memory: this.deps.memory,
    });
    const out = await agent.forward({ memories: formatStoreForConsolidator(all) });
    const after = this.deps.memory.rawCount();
    const delta = after - before;

    if (this.deps.usage) {
      captureProgramUsage(agent.program, {
        store: this.deps.usage,
        purpose: "memory.consolidate",
        runId,
        attribution: usageAttributionForConfig(this.deps.config),
      });
    }

    const summary = delta === 0 ? `no-op: ${out.summary}` : out.summary;
    this.deps.runs.recordComplete(runId, summary);
    if (delta !== 0) {
      this.deps.notify?.({
        kind: "memory.consolidated",
        title: "Memories consolidated",
        body: summary,
        link: "/memory",
      });
    }
    return { summary };
  }

  private updateTask(taskId: string | undefined, patch: Parameters<SqliteTaskStore["update"]>[1]): void {
    if (!taskId || !this.deps.tasks) return;
    const task = this.deps.tasks.update(taskId, patch);
    if (task) this.deps.onTaskStatus?.(task);
  }
}
