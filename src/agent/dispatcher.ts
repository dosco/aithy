import type { Job } from "bunqueue/client";
import {
  MAX_PARALLEL_AGENTS,
  USER_CHAT_JOB_TIMEOUT_MS,
  USER_CHAT_QUEUE_STALE_MS,
} from "../config/limits";
import {
  createEmbeddedQueueWorker,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";

export interface UserChatJobData {
  conversationId: string;
  text: string;
  createdAt: string;
  skillIds: readonly string[];
}

export interface UserChatJobResult {
  conversationId: string;
  text: string;
}

interface PendingJob {
  resolve: (value: UserChatJobResult) => void;
  reject: (error: Error) => void;
  conversationId: string;
}

interface AgentDispatcherOptions {
  stateDbPath: string;
  /** Hard cap on workers consuming user-chat jobs in parallel. */
  parallelAgents: number;
  /** Single-flight gate: must resolve before each job runs. */
  ensureBotSandbox: () => Promise<void>;
  /** Pure processor: takes serializable job data, returns serializable result. */
  process: (data: UserChatJobData) => Promise<UserChatJobResult>;
  onError?: QueueErrorReporter;
}

/**
 * Persistent priority queue for user-chat agent runs, backed by the same
 * `bunqueue.db` store the memory queue uses. Concurrent enqueues serialize
 * through a configurable worker pool. Every worker awaits
 * `ensureBotSandbox()` before pulling the next job, so messages that arrive
 * during VM startup wait for the VM rather than racing it.
 */
export class AgentDispatcher {
  private readonly app: EmbeddedQueueWorker<UserChatJobData, UserChatJobResult>;
  private readonly pending = new Map<string, PendingJob>();

  constructor(private readonly opts: AgentDispatcherOptions) {
    this.app = createEmbeddedQueueWorker<UserChatJobData, UserChatJobResult>({
      name: "aithy.agents.user",
      stateDbPath: opts.stateDbPath,
      processor: (job) => this.runJob(job),
      onError: opts.onError,
    });
    this.setConcurrency(opts.parallelAgents);
    this.app.worker.on("completed", (job, result) => {
      const pending = this.pending.get(job.id);
      if (!pending) return;
      this.pending.delete(job.id);
      pending.resolve(result);
    });
    this.app.worker.on("failed", (job, error) => {
      const pending = this.pending.get(job.id);
      if (!pending) return;
      this.pending.delete(job.id);
      pending.reject(error);
    });
    this.app.worker.on("cancelled", ({ jobId, reason }) => {
      const pending = this.pending.get(jobId);
      if (!pending) return;
      this.pending.delete(jobId);
      pending.reject(new Error(reason || "Cancelled"));
    });
  }

  /** Enqueue a user-chat agent run. Resolves with the agent's reply. */
  async enqueueUserChat(data: UserChatJobData): Promise<UserChatJobResult> {
    const jobId = `agents.user:${crypto.randomUUID()}`;
    const result = new Promise<UserChatJobResult>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject, conversationId: data.conversationId });
    });
    try {
      await this.app.queue.add("user-chat", data, {
        jobId,
        priority: 100,
        timeout: USER_CHAT_JOB_TIMEOUT_MS,
      });
    } catch (error) {
      this.pending.delete(jobId);
      throw error;
    }
    return result;
  }

  /**
   * Reject every queued or in-flight job tagged with this conversation. Other
   * conversations are unaffected. Returns the number of pending jobs we
   * touched (in-flight + queued).
   */
  cancelByConversation(conversationId: string, reason = "Stopped by user"): number {
    let count = 0;
    for (const [jobId, entry] of [...this.pending]) {
      if (entry.conversationId !== conversationId) continue;
      this.app.worker.cancelJob(jobId, reason);
      count += 1;
    }
    return count;
  }

  async close(): Promise<void> {
    for (const [jobId, entry] of [...this.pending]) {
      this.pending.delete(jobId);
      entry.reject(new Error("Aithy is shutting down"));
    }
    await this.app.close();
  }

  /** Hot-reload concurrency from the settings page. Clamped to [1, MAX]. */
  setConcurrency(parallelAgents: number): void {
    const clamped = Math.max(1, Math.min(MAX_PARALLEL_AGENTS, Math.floor(parallelAgents)));
    if (this.app.worker.concurrency !== clamped) {
      this.app.worker.concurrency = clamped;
    }
  }

  private async runJob(job: Job<UserChatJobData>): Promise<UserChatJobResult> {
    if (Date.now() - job.timestamp > USER_CHAT_QUEUE_STALE_MS) {
      throw new Error("user-chat job expired before it could run");
    }
    await this.opts.ensureBotSandbox();
    return this.opts.process(job.data);
  }
}
