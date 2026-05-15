import { Queue, type Job } from "bunqueue/client";
import {
  MAX_PARALLEL_AGENTS,
  USER_CHAT_JOB_TIMEOUT_MS,
} from "../config/limits";
import {
  bunqueueDataPath,
  createEmbeddedQueueWorker,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import type { RuntimeStore } from "../runtime/runtime-store";
import type { RuntimeQueueStatus, RuntimeServiceRole } from "../runtime/protocol/types";
import type { SetupStatusInput } from "../setup/status";

interface RuntimeCommandSubmitter {
  submitCommand(targetRole: RuntimeServiceRole, kind: string, payload?: unknown): Promise<string>;
}

type RuntimeCommandQueue = RuntimeStore | RuntimeCommandSubmitter;

export interface UserChatJobData {
  conversationId: string;
  text: string;
  createdAt: string;
  skillIds: readonly string[];
  disableSystemBash?: boolean;
  responseRunId?: string;
}

export interface UserChatJobResult {
  conversationId: string;
  text: string;
  createdAt: string;
}

export interface EnqueuedUserChatJob {
  jobId: string;
  conversationId: string;
}

export interface UserChatQueueClient {
  enqueueUserChat(data: UserChatJobData): Promise<EnqueuedUserChatJob>;
  cancelByConversation(conversationId: string, reason?: string): number | Promise<number>;
  cancelAll?(reason?: string): number | Promise<number>;
  close(): Promise<void>;
  setConcurrency?(parallelAgents: number): void;
  pause?(reason?: string): void;
  resume?(): void;
  queueStatus?(): RuntimeQueueStatus;
}

interface PendingJob {
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
  onCompleted?: (data: UserChatJobData, result: UserChatJobResult) => void;
  onFailed?: (data: UserChatJobData, error: Error) => void;
  onStatus?: (status: SetupStatusInput) => void;
  onError?: QueueErrorReporter;
}

export class UserChatQueueProducer implements UserChatQueueClient {
  private readonly queue: Queue<UserChatJobData>;

  constructor(stateDbPath: string) {
    this.queue = new Queue<UserChatJobData>("aithy.agents.user", {
      embedded: true,
      dataPath: bunqueueDataPath(stateDbPath),
    });
  }

  async enqueueUserChat(data: UserChatJobData): Promise<EnqueuedUserChatJob> {
    const jobId = `agents.user:${crypto.randomUUID()}`;
    await this.queue.add("user-chat", data, {
      jobId,
      priority: 100,
      timeout: USER_CHAT_JOB_TIMEOUT_MS,
    });
    return { jobId, conversationId: data.conversationId };
  }

  async cancelByConversation(conversationId: string): Promise<number> {
    return this.removeWaiting((data) => data.conversationId === conversationId);
  }

  async cancelAll(): Promise<number> {
    return this.removeWaiting(() => true);
  }

  private async removeWaiting(predicate: (data: UserChatJobData) => boolean): Promise<number> {
    let count = 0;
    const jobs = await this.queue.getJobsAsync({
      state: ["waiting", "delayed", "prioritized"],
      start: 0,
      end: 500,
      asc: true,
    });
    for (const job of jobs) {
      const data = job.data as UserChatJobData | undefined;
      if (!data || !predicate(data)) continue;
      await this.queue.removeAsync(String(job.id));
      count += 1;
    }
    return count;
  }

  async close(): Promise<void> {
    this.queue.close();
  }
}

export class UserChatCommandProducer implements UserChatQueueClient {
  constructor(private readonly store: RuntimeCommandQueue) {}

  async enqueueUserChat(data: UserChatJobData): Promise<EnqueuedUserChatJob> {
    const jobId = await submitRuntimeCommand(this.store, "agent-worker", "enqueue_user_chat", data);
    return { jobId, conversationId: data.conversationId };
  }

  async cancelByConversation(conversationId: string): Promise<number> {
    await submitRuntimeCommand(this.store, "agent-worker", "stop_conversation", { conversationId });
    return 0;
  }

  async cancelAll(): Promise<number> {
    await submitRuntimeCommand(this.store, "agent-worker", "stop_all");
    return 0;
  }

  async close(): Promise<void> {}
}

function submitRuntimeCommand(
  store: RuntimeCommandQueue,
  targetRole: RuntimeServiceRole,
  kind: string,
  payload: unknown = {},
): Promise<string> {
  if ("submitCommand" in store) return store.submitCommand(targetRole, kind, payload);
  return Promise.resolve(store.enqueueCommand(targetRole, kind, payload));
}

/**
 * Persistent priority queue for user-chat agent runs, backed by the same
 * `bunqueue.db` store the memory queue uses. Concurrent enqueues serialize
 * through a configurable worker pool. Each job awaits `ensureBotSandbox()`
 * before processing, so messages that arrive during VM startup wait for the VM
 * rather than racing it.
 */
export class AgentDispatcher implements UserChatQueueClient {
  private readonly app: EmbeddedQueueWorker<UserChatJobData, UserChatJobResult>;
  private readonly pending = new Map<string, PendingJob>();
  private resumeScheduled = false;
  private blockedReason: string | null = null;

  constructor(private readonly opts: AgentDispatcherOptions) {
    this.app = createEmbeddedQueueWorker<UserChatJobData, UserChatJobResult>({
      name: "aithy.agents.user",
      stateDbPath: opts.stateDbPath,
      processor: (job) => this.runJob(job),
      onError: opts.onError,
    });
    this.setConcurrency(opts.parallelAgents);
    this.app.worker.on("completed", (job, result) => {
      const jobId = String(job.id);
      const pending = this.pending.get(jobId);
      if (pending) this.pending.delete(jobId);
      this.opts.onCompleted?.(job.data, result);
    });
    this.app.worker.on("failed", (job, error) => {
      const jobId = String(job.id);
      const pending = this.pending.get(jobId);
      if (pending) this.pending.delete(jobId);
      this.opts.onFailed?.(job.data, error);
    });
    this.app.worker.on("cancelled", ({ jobId }) => {
      const pending = this.pending.get(jobId);
      if (!pending) return;
      this.pending.delete(jobId);
    });
  }

  /** Enqueue a user-chat agent run and return as soon as the queue accepts it. */
  async enqueueUserChat(data: UserChatJobData): Promise<EnqueuedUserChatJob> {
    const jobId = `agents.user:${crypto.randomUUID()}`;
    this.pending.set(jobId, { conversationId: data.conversationId });
    this.app.worker.pause();
    try {
      await this.app.queue.add("user-chat", data, {
        jobId,
        priority: 100,
        timeout: USER_CHAT_JOB_TIMEOUT_MS,
      });
    } catch (error) {
      this.pending.delete(jobId);
      throw error;
    } finally {
      this.resumeWorkerSoon();
    }
    return { jobId, conversationId: data.conversationId };
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

  cancelAll(reason = "Stopped by user"): number {
    let count = 0;
    for (const [jobId] of [...this.pending]) {
      this.app.worker.cancelJob(jobId, reason);
      count += 1;
    }
    return count;
  }

  async close(): Promise<void> {
    for (const [jobId] of [...this.pending]) {
      this.pending.delete(jobId);
    }
    await this.app.close();
  }

  pause(reason = "paused"): void {
    this.blockedReason = reason;
    this.app.worker.pause();
  }

  resume(): void {
    this.blockedReason = null;
    if (!this.app.worker.isClosed()) this.app.worker.resume();
  }

  queueStatus(
    dependencyRoles: RuntimeServiceRole[] = ["sandbox-worker", "embedding-worker"],
  ): RuntimeQueueStatus {
    return {
      id: "agent.chat",
      ownerRole: "agent-worker",
      state: this.blockedReason ? "blocked" : this.pending.size > 0 ? "running" : "idle",
      depth: this.pending.size,
      activeCount: 0,
      blockedReason: this.blockedReason ?? undefined,
      dependencyRoles,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Hot-reload concurrency from the settings page. Clamped to [1, MAX]. */
  setConcurrency(parallelAgents: number): void {
    const clamped = Math.max(1, Math.min(MAX_PARALLEL_AGENTS, Math.floor(parallelAgents)));
    if (this.app.worker.concurrency !== clamped) {
      this.app.worker.concurrency = clamped;
    }
  }

  private async runJob(job: Job<UserChatJobData>): Promise<UserChatJobResult> {
    const jobId = String(job.id);
    if (!this.pending.has(jobId)) {
      // The queue-service is the durable chat queue. Local Bunqueue leftovers
      // from an older agent process should not replay or surface as chat errors.
      return {
        conversationId: job.data.conversationId,
        text: "",
        createdAt: new Date().toISOString(),
      };
    }
    this.opts.onStatus?.({ key: "agent", label: "Please wait agent starting", active: true });
    try {
      await this.opts.ensureBotSandbox();
      this.opts.onStatus?.({ key: "agent", label: "agent started", active: false });
      return await this.opts.process(job.data);
    } catch (error) {
      this.opts.onStatus?.({ key: "agent", label: "agent start ended", active: false });
      throw error;
    }
  }

  private resumeWorkerSoon(): void {
    if (this.blockedReason) return;
    if (this.resumeScheduled) return;
    this.resumeScheduled = true;
    setImmediate(() => {
      this.resumeScheduled = false;
      if (this.blockedReason) return;
      if (!this.app.worker.isClosed()) this.app.worker.resume();
    });
  }
}
