import { Queue, type Job } from "bunqueue/client";
import type { AppConfig } from "../config/env";
import {
  bunqueueDataPath,
  createEmbeddedQueueWorker,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import { createConsolidatorAgent, formatStoreForConsolidator } from "./consolidator-agent";
import type { SqliteMemoryStore } from "./memory-store";
import type { SqliteMemoryRunsStore } from "./memory-runs";
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage } from "../usage/capture";

const MAX_ATTEMPTS = 2;
const JOB_TTL_MS = 5 * 60_000;
const CRON_PATTERN = "0 3 * * *"; // every day at 03:00 local time

interface JobData {
  runId: string;
  triggeredAt: string;
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
        deduplication: { id: "consolidate:adhoc", ttl: 30_000 },
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
    await this.app.queue.add(
      "memory.consolidate.now",
      { runId, triggeredAt: new Date().toISOString() },
      {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 30_000 },
        deduplication: { id: "consolidate:adhoc", ttl: 30_000 },
        jobId: `memory:consolidate:${runId}`,
      },
    );
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  private async processJob(job: Job<JobData>): Promise<{ summary: string }> {
    if (Date.now() - job.timestamp > JOB_TTL_MS) {
      return { summary: "job expired" };
    }
    return this.process(job.data);
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
    const agent = createConsolidatorAgent({ config: this.deps.config, memory: this.deps.memory });
    const out = await agent.forward({ memories: formatStoreForConsolidator(all) });
    const after = this.deps.memory.rawCount();
    const delta = after - before;

    if (this.deps.usage) {
      captureProgramUsage(agent.program, {
        store: this.deps.usage,
        purpose: "memory.consolidate",
        runId,
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
}
