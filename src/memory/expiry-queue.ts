import type { Job } from "bunqueue/client";
import type { AppConfig } from "../config/env";
import {
  createEmbeddedQueueWorker,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import type { SqliteMemoryStore } from "./memory-store";
import { todayLocalDate } from "./time-bound";

const MAX_ATTEMPTS = 2;
const JOB_TTL_MS = 5 * 60_000;
const CRON_PATTERN = "30 2 * * *"; // every day at 02:30 local time

interface JobData {
  triggeredAt: string;
}

export interface MemoryExpiryQueueDeps {
  config: AppConfig;
  memory: SqliteMemoryStore;
  notify?: (input: {
    kind: "memory.consolidated";
    title: string;
    body?: string | null;
    link?: string | null;
  }) => void;
  onQueueError?: QueueErrorReporter;
}

export class MemoryExpiryQueue {
  private readonly app: EmbeddedQueueWorker<JobData, { deleted: number }>;

  constructor(private readonly deps: MemoryExpiryQueueDeps) {
    this.app = createEmbeddedQueueWorker<JobData, { deleted: number }>({
      name: "aithy.memory.expiry",
      stateDbPath: deps.config.stateDbPath,
      processor: (job) => this.processJob(job),
      onError: deps.onQueueError,
    });
  }

  async schedule(): Promise<void> {
    await this.app.queue.upsertJobScheduler(
      "memory.expiry.daily",
      { pattern: CRON_PATTERN },
      {
        name: "memory.expiry.daily",
        data: { triggeredAt: new Date().toISOString() },
        opts: {
          attempts: MAX_ATTEMPTS,
          backoff: { type: "exponential", delay: 30_000 },
        },
      },
    );
  }

  async runNow(): Promise<void> {
    const id = crypto.randomUUID();
    await this.app.queue.add(
      "memory.expiry.now",
      { triggeredAt: new Date().toISOString() },
      {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 30_000 },
        deduplication: { id: "expiry:adhoc", ttl: 30_000 },
        jobId: `memory:expiry:${id}`,
      },
    );
  }

  async close(): Promise<void> {
    await this.app.close();
  }

  private async processJob(job: Job<JobData>): Promise<{ deleted: number }> {
    if (Date.now() - job.timestamp > JOB_TTL_MS) return { deleted: 0 };
    return this.process();
  }

  private process(): { deleted: number } {
    const deleted = this.deps.memory.deleteExpired(todayLocalDate());
    if (deleted > 0) {
      this.deps.notify?.({
        kind: "memory.consolidated",
        title: "Expired memories removed",
        body: `Deleted ${deleted} expired ${deleted === 1 ? "memory" : "memories"}.`,
        link: "/memory",
      });
    }
    return { deleted };
  }
}
