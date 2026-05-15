import type { Job, JobOptions } from "bunqueue/client";
import type { AppConfig } from "../config/env";
import type { SessionManager } from "../session/session-manager";
import type { BotMessage } from "../session/types";
import {
  createEmbeddedQueueWorker,
  getJobFailureAttempt,
  isDuplicateJobWriteError,
  type EmbeddedQueueWorker,
  type QueueErrorReporter,
} from "../queue/embedded";
import { shouldQueueAutoMemory } from "./auto-gate";
import {
  SqliteMemoryExtractionStore,
  type MemoryExtractionMessage,
  type MemoryExtractionSegment,
} from "./extraction-store";
import { createMemoryAgent, type MemoryAgent, type MemoryAgentDeps } from "./memory-agent";
import type { SqliteMemoryStore } from "./memory-store";
import type { SqliteMemoryRunsStore } from "./memory-runs";
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage } from "../usage/capture";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/types";

export const AUTO_MEMORY_BATCH_DELAY_MS = 10 * 60_000;
export const AUTO_MEMORY_DEDUP_TTL_MS = 15 * 60_000;
export const AUTO_MEMORY_MAX_MESSAGES_PER_RUN = 200;
export const AUTO_MEMORY_OVERLAP_MESSAGES = 20;
const MAX_ATTEMPTS = 3;
// Hard cap on a single triage attempt. A wedged LLM call would otherwise tie up
// the worker indefinitely; bunqueue's TTL kills the job and lets the dedup
// window expire so future turns can retry from scratch.
const JOB_TTL_MS = 90_000;

export type MemoryJobData =
  | { trigger: "auto"; sourceSessionId?: string; sessionId?: string; runId: string; taskId?: string }
  | { trigger: "explicit"; sessionId: string; hint: string; runId: string; taskId?: string };

export interface PostToSubSession {
  (input: {
    parentSessionId: string;
    parentMessageId?: number | null;
    text: string;
    name?: string;
  }): Promise<{ sessionId: string; messageId: number | null }> | { sessionId: string; messageId: number | null };
}

export interface MemoryQueueDeps {
  config: AppConfig;
  memory: SqliteMemoryStore;
  sessions: SessionManager;
  runs: SqliteMemoryRunsStore;
  tasks?: SqliteTaskStore;
  onTaskStatus?: (task: TaskRecord) => void;
  extractions?: SqliteMemoryExtractionStore;
  agentFactory?: (deps: MemoryAgentDeps) => MemoryAgent;
  postFailureToSubSession: PostToSubSession;
  /** Surface a triage outcome to the user via the notifications subsystem. */
  notify?: (input: {
    kind: "memory.written" | "memory.failed";
    title: string;
    body?: string | null;
    link?: string | null;
  }) => void;
  usage?: SqliteUsageStore;
  onQueueError?: QueueErrorReporter;
}

export class MemoryQueue {
  private readonly app: EmbeddedQueueWorker<MemoryJobData, { summary: string }>;
  private readonly extractions: SqliteMemoryExtractionStore;
  private readonly ownsExtractions: boolean;

  constructor(private readonly deps: MemoryQueueDeps) {
    this.extractions = deps.extractions ?? new SqliteMemoryExtractionStore(deps.config.stateDbPath);
    this.ownsExtractions = !deps.extractions;
    this.app = createEmbeddedQueueWorker<MemoryJobData, { summary: string }>({
      name: "aithy.memory",
      stateDbPath: deps.config.stateDbPath,
      processor: (job) => this.processJob(job),
      onError: deps.onQueueError,
    });

    // bunqueue emits 'failed' on every attempt; we only want to surface to the
    // user (and record terminal failure) once retries are exhausted.
    this.app.worker.on("failed", (job, error) => {
      const attempt = getJobFailureAttempt(job);
      if (attempt < MAX_ATTEMPTS) return;
      const data = job.data as MemoryJobData;
      void (async () => {
        const sub = await deps.postFailureToSubSession({
          parentSessionId: failureParentSessionId(data),
          text: `Memory triage failed after ${attempt} attempt(s): ${error.message}`,
          name: "Memory error",
        });
        try {
          deps.runs.recordFail(data.runId, error.message, sub.sessionId);
        } catch {
          // run row may not exist if start was never recorded
        }
        deps.notify?.({
          kind: "memory.failed",
          title: "Memory triage failed",
          body: error.message,
          link: `/chat/${sub.sessionId}`,
        });
      })().catch((cause) => {
        deps.onQueueError?.("[aithy.memory] failed to post terminal failure", cause instanceof Error ? cause : new Error(String(cause)));
      });
    });
  }

  async enqueueAuto(sourceSessionId: string): Promise<void> {
    const runId = crypto.randomUUID();
    const task = this.deps.tasks?.create({
      kind: "memory.auto",
      title: "Update memory from recent conversation",
      conversationId: sourceSessionId,
      relatedSessionId: sourceSessionId,
      reason: "Queued for memory triage",
      metadata: { sourceSessionId },
    });
    if (task) this.deps.onTaskStatus?.(task);
    try {
      await this.app.queue.add(
        "memory.auto",
        { trigger: "auto", sourceSessionId, runId, ...(task ? { taskId: task.id } : {}) },
        autoMemoryJobOptions(runId),
      );
    } catch (error) {
      if (isDuplicateJobWriteError(error)) {
        if (task) {
          const cancelled = this.deps.tasks?.update(task.id, {
            status: "cancelled",
            reason: "Duplicate memory task was already queued",
          });
          if (cancelled) this.deps.onTaskStatus?.(cancelled);
        }
        this.deps.onQueueError?.("[aithy.memory] duplicate auto-memory job ignored", error as Error);
        return;
      }
      if (task) {
        const failed = this.deps.tasks?.update(task.id, {
          status: "failed",
          reason: "Could not queue memory task",
          errorSummary: error instanceof Error ? error.message : String(error),
        });
        if (failed) this.deps.onTaskStatus?.(failed);
      }
      throw error;
    }
  }

  async enqueueExplicit(sessionId: string, hint: string): Promise<void> {
    const runId = crypto.randomUUID();
    const task = this.deps.tasks?.create({
      kind: "memory.explicit",
      title: "Remember requested information",
      conversationId: sessionId,
      relatedSessionId: sessionId,
      reason: "Queued for memory triage",
      metadata: { hint },
    });
    if (task) this.deps.onTaskStatus?.(task);
    await this.app.queue.add(
      "memory.explicit",
      { trigger: "explicit", sessionId, hint, runId, ...(task ? { taskId: task.id } : {}) },
      // Unique dedup id per call so user-driven asks always queue.
      {
        attempts: MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 10_000 },
        deduplication: { id: `explicit:${sessionId}:${runId}`, ttl: 1_000 },
        jobId: `memory:explicit:${runId}`,
        priority: 10,
      },
    );
  }

  async close(): Promise<void> {
    await this.app.close();
    if (this.ownsExtractions) this.extractions.close();
  }

  private async processJob(job: Job<MemoryJobData>): Promise<{ summary: string }> {
    this.updateTask(job.data.taskId, {
      status: "running",
      queueJobId: String(job.id),
      reason: "Memory triage is running",
    });
    const availableAt = job.timestamp + (job.delay ?? job.opts.delay ?? 0);
    if (Date.now() - availableAt > JOB_TTL_MS) {
      this.updateTask(job.data.taskId, {
        status: "cancelled",
        reason: "Memory task expired before it could run",
      });
      return { summary: "job expired" };
    }
    try {
      const result = await this.process(job.data);
      this.updateTask(job.data.taskId, {
        status: "completed",
        reason: "Memory triage completed",
        resultSummary: result.summary,
      });
      return result;
    } catch (error) {
      this.updateTask(job.data.taskId, {
        status: "failed",
        reason: "Memory triage failed",
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async process(data: MemoryJobData): Promise<{ summary: string }> {
    if (data.trigger === "auto") return this.processAuto();
    return this.processExplicit(data);
  }

  private async processExplicit(data: Extract<MemoryJobData, { trigger: "explicit" }>): Promise<{ summary: string }> {
    if (!this.deps.sessions.getSummary(data.sessionId)) {
      return { summary: "session deleted" };
    }

    const transcript = this.deps.sessions.getTranscript(data.sessionId);
    const thread = formatThread(transcript);
    return this.runAgent({
      trigger: "explicit",
      sessionId: data.sessionId,
      runId: data.runId,
      hint: data.hint,
      thread,
    });
  }

  private async processAuto(): Promise<{ summary: string }> {
    const batch = this.extractions.loadBatch({
      limit: AUTO_MEMORY_MAX_MESSAGES_PER_RUN,
      overlap: AUTO_MEMORY_OVERLAP_MESSAGES,
    });
    if (batch.inspectedCount === 0) return { summary: "no new messages" };

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    try {
      for (const segment of batch.segments) {
        if (!shouldInspectMemorySegment(segment)) {
          skipped += 1;
          continue;
        }
        const runId = crypto.randomUUID();
        try {
          await this.runAgent({
            trigger: "auto",
            sessionId: segment.sessionId,
            runId,
            thread: formatSegmentThread(segment),
          });
          processed += 1;
        } catch (error) {
          failed += 1;
          await this.recordAutoFailure(segment.sessionId, runId, error);
        }
      }
    } finally {
      this.extractions.setCursor(batch.nextCursor);
    }

    return {
      summary: `inspected ${batch.inspectedCount} message(s), processed ${processed} segment(s), skipped ${skipped}, failed ${failed}`,
    };
  }

  private async runAgent(input: {
    trigger: "auto" | "explicit";
    sessionId: string;
    runId: string;
    hint?: string;
    thread: string;
  }): Promise<{ summary: string }> {
    this.deps.runs.recordStart({
      id: input.runId,
      sessionId: input.sessionId,
      trigger: input.trigger,
    });
    const agentFactory = this.deps.agentFactory ?? createMemoryAgent;
    const agent = agentFactory({
      config: this.deps.config,
      memory: this.deps.memory,
    });
    // Snapshot raw row count so we can detect hallucinated tool calls. Any
    // real write/supersede/delete shifts the count; performative narration
    // doesn't.
    const beforeCount = this.deps.memory.rawCount();
    const out = await agent.forward({
      trigger: input.trigger,
      hint: input.hint,
      thread: input.thread,
    });
    const afterCount = this.deps.memory.rawCount();

    const anyToolFired = afterCount !== beforeCount;
    const summary = reconcileSummary(out.summary, anyToolFired);
    this.deps.runs.recordComplete(input.runId, summary);
    if (this.deps.usage) {
      captureProgramUsage(agent.program, {
        store: this.deps.usage,
        purpose: "memory.triage",
        sessionId: input.sessionId,
        runId: input.runId,
      });
    }
    if (anyToolFired) {
      const latest = afterCount > beforeCount ? this.deps.memory.mostRecent() : null;
      this.deps.notify?.({
        kind: "memory.written",
        title: latest ? `Saved to memory: ${latest.title}` : "Memory updated",
        body: latest ? latest.body : summary,
        link: "/memory",
      });
    }
    return { summary };
  }

  private async recordAutoFailure(sessionId: string, runId: string, cause: unknown): Promise<void> {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    try {
      const sub = await this.deps.postFailureToSubSession({
        parentSessionId: sessionId,
        text: `Memory triage failed: ${error.message}`,
        name: "Memory error",
      });
      this.deps.runs.recordFail(runId, error.message, sub.sessionId);
      this.deps.notify?.({
        kind: "memory.failed",
        title: "Memory triage failed",
        body: error.message,
        link: `/chat/${sub.sessionId}`,
      });
    } catch (postError) {
      this.deps.onQueueError?.(
        "[aithy.memory] failed to record auto-memory failure",
        postError instanceof Error ? postError : new Error(String(postError)),
      );
    }
    this.deps.onQueueError?.(`[aithy.memory] failed to inspect session ${sessionId}`, error);
  }

  private updateTask(taskId: string | undefined, patch: Parameters<SqliteTaskStore["update"]>[1]): void {
    if (!taskId || !this.deps.tasks) return;
    const task = this.deps.tasks.update(taskId, patch);
    if (task) this.deps.onTaskStatus?.(task);
  }
}

export function autoMemoryJobOptions(runId: string): JobOptions {
  return {
    attempts: MAX_ATTEMPTS,
    backoff: { type: "exponential", delay: 10_000 },
    delay: AUTO_MEMORY_BATCH_DELAY_MS,
    deduplication: {
      id: "auto",
      ttl: AUTO_MEMORY_DEDUP_TTL_MS,
      extend: true,
      replace: true,
    },
    jobId: `memory:auto:${runId}`,
  };
}

export function shouldInspectMemorySegment(segment: MemoryExtractionSegment): boolean {
  const messages = segment.messages.map((item) => item.message);
  for (const item of segment.newMessages) {
    if (item.message.role !== "user") continue;
    const index = segment.messages.findIndex((candidate) => candidate.id === item.id);
    const priorMessages = index > 0 ? messages.slice(0, index) : [];
    if (shouldQueueAutoMemory({ userText: item.message.content, priorMessages })) return true;
  }
  return false;
}

const ACTION_LIKE = /\b(saved|stored|persist(ed)?|wrote|recorded|remembered|noted|added|superseded|replaced|deleted|removed)\b/i;

function reconcileSummary(rawSummary: string, anyToolFired: boolean): string {
  const summary = rawSummary.trim();
  if (anyToolFired) return summary;
  if (ACTION_LIKE.test(summary)) {
    // Model narrated a tool call it didn't make. Don't pass the lie through.
    return `[no-op] agent reported "${summary}" but no memory was persisted`;
  }
  return summary || "nothing to remember";
}

function formatThread(messages: readonly BotMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "user") return `[${m.createdAt}] user: ${m.content}`;
      if (m.kind === "text") return `[${m.createdAt}] assistant: ${m.content}`;
      if (m.kind === "permission") return `[${m.createdAt}] permission ${m.toolName}: ${m.status}`;
      if (m.kind === "artifact") return `[${m.createdAt}] artifact ${m.title}: ${m.sandboxPath}`;
      return `[${m.createdAt}] tool ${m.toolName}: ${safeJson(m.toolArgs)}`;
    })
    .join("\n");
}

function formatSegmentThread(segment: MemoryExtractionSegment): string {
  return segment.messages.map((item) => formatSegmentMessage(item)).join("\n");
}

function formatSegmentMessage(item: MemoryExtractionMessage): string {
  const prefix = `[${item.kind} #${item.id} ${item.message.createdAt}]`;
  const message = item.message;
  if (message.role === "user") return `${prefix} user: ${message.content}`;
  if (message.kind === "text") return `${prefix} assistant: ${message.content}`;
  if (message.kind === "permission") return `${prefix} permission ${message.toolName}: ${message.status}`;
  if (message.kind === "artifact") return `${prefix} artifact ${message.title}: ${message.sandboxPath}`;
  return `${prefix} tool ${message.toolName}: ${safeJson(message.toolArgs)}`;
}

function failureParentSessionId(data: MemoryJobData): string {
  return data.trigger === "auto" ? data.sourceSessionId ?? data.sessionId ?? "system" : data.sessionId;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "[unserializable]";
  }
}
