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
import { createMemoryAgent } from "./memory-agent";
import type { SqliteMemoryStore } from "./memory-store";
import type { SqliteMemoryRunsStore } from "./memory-runs";
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage } from "../usage/capture";

export const AUTO_MEMORY_BATCH_DELAY_MS = 10 * 60_000;
export const AUTO_MEMORY_DEDUP_TTL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;
// Hard cap on a single triage attempt. A wedged LLM call would otherwise tie up
// the worker indefinitely; bunqueue's TTL kills the job and lets the dedup
// window expire so future turns can retry from scratch.
const JOB_TTL_MS = 90_000;

export interface MemoryJobData {
  trigger: "auto" | "explicit";
  sessionId: string;
  finalMessageId?: number;
  hint?: string;
  runId: string;
}

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

  constructor(private readonly deps: MemoryQueueDeps) {
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
          parentSessionId: data.sessionId,
          parentMessageId: data.finalMessageId,
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

  async enqueueAuto(sessionId: string, finalMessageId?: number): Promise<void> {
    const runId = crypto.randomUUID();
    try {
      await this.app.queue.add(
        "memory.auto",
        { trigger: "auto", sessionId, finalMessageId, runId },
        autoMemoryJobOptions(sessionId, runId),
      );
    } catch (error) {
      if (isDuplicateJobWriteError(error)) {
        this.deps.onQueueError?.("[aithy.memory] duplicate auto-memory job ignored", error as Error);
        return;
      }
      throw error;
    }
  }

  async enqueueExplicit(sessionId: string, hint: string): Promise<void> {
    const runId = crypto.randomUUID();
    await this.app.queue.add(
      "memory.explicit",
      { trigger: "explicit", sessionId, hint, runId },
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
  }

  private async processJob(job: Job<MemoryJobData>): Promise<{ summary: string }> {
    const availableAt = job.timestamp + (job.delay ?? job.opts.delay ?? 0);
    if (Date.now() - availableAt > JOB_TTL_MS) {
      return { summary: "job expired" };
    }
    return this.process(job.data);
  }

  private async process(data: MemoryJobData): Promise<{ summary: string }> {
    if (!this.deps.sessions.getSummary(data.sessionId)) {
      return { summary: "session deleted" };
    }

    this.deps.runs.recordStart({
      id: data.runId,
      sessionId: data.sessionId,
      trigger: data.trigger,
    });

    const agent = createMemoryAgent({
      config: this.deps.config,
      memory: this.deps.memory,
    });

    const transcript = this.deps.sessions.getTranscript(data.sessionId);
    const thread = formatThread(transcript);

    // Snapshot raw row count so we can detect hallucinated tool calls. Any
    // real write/supersede/delete shifts the count; performative narration
    // doesn't.
    const beforeCount = this.deps.memory.rawCount();
    const out = await agent.forward({
      trigger: data.trigger,
      hint: data.hint,
      thread,
    });
    const afterCount = this.deps.memory.rawCount();

    const anyToolFired = afterCount !== beforeCount;
    const summary = reconcileSummary(out.summary, anyToolFired);
    this.deps.runs.recordComplete(data.runId, summary);
    if (this.deps.usage) {
      captureProgramUsage(agent.program, {
        store: this.deps.usage,
        purpose: "memory.triage",
        sessionId: data.sessionId,
        runId: data.runId,
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
}

export function autoMemoryJobOptions(sessionId: string, runId: string): JobOptions {
  return {
    attempts: MAX_ATTEMPTS,
    backoff: { type: "exponential", delay: 10_000 },
    delay: AUTO_MEMORY_BATCH_DELAY_MS,
    deduplication: {
      id: `auto:${sessionId}`,
      ttl: AUTO_MEMORY_DEDUP_TTL_MS,
      extend: true,
      replace: true,
    },
    jobId: `memory:auto:${runId}`,
  };
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
      return `[${m.createdAt}] tool ${m.toolName}: ${safeJson(m.toolArgs)}`;
    })
    .join("\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "[unserializable]";
  }
}
