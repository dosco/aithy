import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import type { AppConfig } from "../src/config/env";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { SqliteMemoryRunsStore } from "../src/memory/memory-runs";
import { buildMemoryAgentTools } from "../src/memory/agent-tools";
import { SqliteMemoryExtractionStore } from "../src/memory/extraction-store";
import {
  AUTO_MEMORY_BATCH_DELAY_MS,
  AUTO_MEMORY_DEDUP_TTL_MS,
  AUTO_MEMORY_OVERLAP_MESSAGES,
  MemoryQueue,
  type MemoryJobData,
  autoMemoryJobOptions,
} from "../src/memory/memory-queue";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { BotMessage } from "../src/session/types";
import { SqliteTaskStore } from "../src/tasks/task-store";

const queues: MemoryQueue[] = [];
const stores: Array<{ close(): void }> = [];

// bunqueue keeps a process-wide singleton manager keyed to the first dataPath
// it sees. Reset between tests so each gets a fresh sandbox.
afterEach(async () => {
  for (const q of queues.splice(0)) {
    try {
      await q.close();
    } catch {
      // ignore
    }
  }
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      // ignore
    }
  }
  try {
    shutdownManager();
  } catch {
    // ignore
  }
});

async function makeQueue() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-mq-"));
  const stateDbPath = path.join(dir, "state.db");
  const memory = new SqliteMemoryStore(stateDbPath);
  const runs = new SqliteMemoryRunsStore(stateDbPath);
  const tasks = new SqliteTaskStore(stateDbPath);

  const queueErrors: string[] = [];
  // Stub session manager — auto jobs for missing sessions complete as no-ops.
  const sessions = {
    getSummary: () => null,
    getTranscript: () => [],
  } as unknown as SessionManager;

  const config = {
    stateDbPath,
    aiProvider: "openai",
    aiModel: "test",
  } as unknown as AppConfig;

  const post = () => ({ sessionId: "stub", messageId: null });
  const queue = new MemoryQueue({
    config,
    memory,
    sessions,
    runs,
    tasks,
    postFailureToSubSession: post,
    onQueueError: (message) => queueErrors.push(message),
  });
  queues.push(queue);
  stores.push(memory, runs, tasks);
  return { queue, runs, tasks, queueErrors };
}

describe("MemoryQueue", () => {
  test("constructs without throwing and exposes enqueue methods", async () => {
    const { queue } = await makeQueue();
    expect(typeof queue.enqueueAuto).toBe("function");
    expect(typeof queue.enqueueExplicit).toBe("function");
    expect(typeof queue.close).toBe("function");
  });

  test("enqueueAuto twice dedupes the second global auto job", async () => {
    const { queue } = await makeQueue();
    await queue.enqueueAuto("session-x");
    // The second call within the dedup TTL should be a no-op (no throw).
    await queue.enqueueAuto("session-x");
    // Close before the worker actually runs the job to avoid invoking the LLM.
    await queue.close();
  });

  test("enqueueAuto reuses the planned task while the job is debounced", async () => {
    const { queue, tasks } = await makeQueue();

    await queue.enqueueAuto("session-a");
    await queue.enqueueAuto("session-b");

    const active = tasks.recent({ status: "active", limit: 10 })
      .filter((task) => task.kind === "memory.auto");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      status: "planned",
      dedupeKey: "memory:auto",
      conversationId: "session-b",
      relatedSessionId: "session-b",
      metadata: {
        sourceSessionId: "session-b",
      },
    });
  });

  test("auto memory jobs are delayed and globally debounced", () => {
    const opts = autoMemoryJobOptions("run-y");

    expect(opts.delay).toBe(AUTO_MEMORY_BATCH_DELAY_MS);
    expect(opts.deduplication).toEqual({
      id: "memory:auto",
      ttl: AUTO_MEMORY_DEDUP_TTL_MS,
      extend: true,
      replace: true,
    });
    expect(opts.jobId).toBe("memory:auto:run-y");
  });

  test("worker error events are captured instead of thrown", async () => {
    const { queue, queueErrors } = await makeQueue();
    const internals = queue as unknown as {
      app: { worker: { emit: (event: "error", error: Error) => boolean } };
    };

    const emitted = internals.app.worker.emit(
      "error",
      Object.assign(new Error("Invalid or expired lock token for job auto:session-x"), {
        context: "fail",
        jobId: "auto:session-x",
      }),
    );

    expect(emitted).toBe(true);
    expect(queueErrors).toHaveLength(1);
    expect(queueErrors[0]).toContain("Invalid or expired lock token");
  });

  test("terminal failures can post from legacy auto job payloads", async () => {
    const { queue } = await makeQueue();
    const posts: string[] = [];
    (queue as unknown as { deps: { postFailureToSubSession: (input: { parentSessionId: string }) => { sessionId: string; messageId: null } } })
      .deps.postFailureToSubSession = (input) => {
        posts.push(input.parentSessionId);
        return { sessionId: "stub", messageId: null };
      };
    const internals = queue as unknown as {
      app: { worker: { emit: (event: "failed", job: unknown, error: Error) => boolean } };
    };

    internals.app.worker.emit("failed", {
      attemptsMade: 2,
      attemptsStarted: 2,
      data: { trigger: "auto", sessionId: "legacy-session", runId: "legacy-run" },
    }, new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(posts).toEqual(["legacy-session"]);
  });

  test("embedded worker lock ownership is disabled", async () => {
    const { queue } = await makeQueue();
    const internals = queue as unknown as {
      app: { worker: { opts: { useLocks: boolean } } };
    };

    expect(internals.app.worker.opts.useLocks).toBe(false);
  });

  test("auto processing uses only messages after the cursor with bounded overlap", async () => {
    const fx = await makeProcessingQueue();
    fx.sessions.ensureLogicalSession("main");
    const oldCount = AUTO_MEMORY_OVERLAP_MESSAGES + 5;
    for (let i = 1; i <= oldCount; i += 1) {
      append(fx.sessions, "main", assistant(i === 1 ? "ancient assistant reply" : `old assistant reply ${i}`));
    }
    fx.extractions.setCursor(oldCount);
    append(fx.sessions, "main", user("my favourite city is Vancouver"));
    append(fx.sessions, "main", assistant("I'll remember that."));

    await runAuto(fx.queue);

    expect(fx.seenThreads).toHaveLength(1);
    expect(fx.seenThreads[0]).not.toContain("ancient assistant reply");
    expect(fx.seenThreads[0]).toContain(`[context #${oldCount}`);
    expect(fx.seenThreads[0]).toContain(`[new #${oldCount + 1}`);
    expect(fx.seenThreads[0]).toContain("my favourite city is Vancouver");
    expect(fx.extractions.cursor()).toBe(oldCount + 2);
  });

  test("gated auto segments avoid model calls and still advance the cursor", async () => {
    const fx = await makeProcessingQueue();
    fx.sessions.ensureLogicalSession("main");
    append(fx.sessions, "main", user("ok"));
    append(fx.sessions, "main", assistant("done"));

    await runAuto(fx.queue);

    expect(fx.seenThreads).toEqual([]);
    expect(fx.extractions.cursor()).toBe(2);
    expect(fx.runs.recent(5)).toEqual([]);
  });

  test("auto triage skips cleanly when AI settings are incomplete", async () => {
    let called = false;
    const fx = await makeProcessingQueue({
      configPatch: { aiApiKey: undefined },
      forward: async () => {
        called = true;
        return { summary: "should not run" };
      },
    });
    fx.sessions.ensureLogicalSession("main");
    append(fx.sessions, "main", user("my favourite city is Vancouver"));

    const result = await runAuto(fx.queue);

    expect(result.summary).toContain("memory triage skipped");
    expect(result.summary).toContain("provider API key");
    expect(called).toBe(false);
    expect(fx.runs.recent(5)).toEqual([]);
  });

  test("auto triage uses refreshed queue config after settings reload", async () => {
    let called = false;
    const fx = await makeProcessingQueue({
      forward: async () => {
        called = true;
        return { summary: "should not run" };
      },
    });
    fx.queue.updateConfig({ ...fx.config, aiApiKey: undefined });
    fx.sessions.ensureLogicalSession("main");
    append(fx.sessions, "main", user("my favourite city is Vancouver"));

    const result = await runAuto(fx.queue);

    expect(result.summary).toContain("memory triage skipped");
    expect(result.summary).toContain("provider API key");
    expect(called).toBe(false);
    expect(fx.runs.recent(5)).toEqual([]);
  });

  test("auto processing skips sub-session messages while advancing past them", async () => {
    const fx = await makeProcessingQueue();
    fx.sessions.ensureLogicalSession("main");
    fx.sessions.ensureLogicalSession("child", { parentSessionId: "main" });
    append(fx.sessions, "child", user("my favourite snack is apples"));

    await runAuto(fx.queue);

    expect(fx.seenThreads).toEqual([]);
    expect(fx.extractions.cursor()).toBe(1);
  });

  test("auto model failures are recorded without retrying the batch", async () => {
    const fx = await makeProcessingQueue({
      forward: async () => {
        throw new Error("model down");
      },
    });
    fx.sessions.ensureLogicalSession("main");
    append(fx.sessions, "main", user("my favourite city is Vancouver"));

    const result = await runAuto(fx.queue);

    expect(result.summary).toContain("failed 1");
    expect(fx.extractions.cursor()).toBe(1);
    expect(fx.queueErrors.at(-1)).toContain("failed to inspect session main");
    expect(fx.runs.recent(1)[0]).toMatchObject({ status: "failed", error: "model down" });
  });

  test("deduped memory writes do not create rows and cursor still advances", async () => {
    const fx = await makeProcessingQueue({
      forward: async (input, ctx) => {
        fx.seenThreads.push(input.thread);
        const write = buildMemoryAgentTools({
          config: ctx.config,
          memory: ctx.memory,
          dedupeDecider: { isDuplicate: async (_candidate, matches) => matches.length > 0 },
        }).find((tool) => tool.name === "write") as any;
        await write.func({
          kind: "fact",
          title: "uses bun runtime",
          body: "The user runs project commands with bun.",
        });
        return { summary: "nothing to remember" };
      },
    });
    fx.memory.upsert({
      kind: "fact",
      title: "uses bun runtime",
      body: "The user runs project commands with bun.",
    });
    fx.sessions.ensureLogicalSession("main");
    append(fx.sessions, "main", user("I use bun for this project"));

    await runAuto(fx.queue);

    expect(fx.memory.count()).toBe(1);
    expect(fx.extractions.cursor()).toBe(1);
    expect(fx.notifications).toEqual([]);
    expect(fx.memory.recent(1)[0].retrievedCount).toBe(0);
  });
});

async function makeProcessingQueue(options: {
  configPatch?: Partial<AppConfig>;
  forward?: (
    input: { trigger: "auto" | "explicit"; hint?: string; thread: string },
    ctx: { config: AppConfig; memory: SqliteMemoryStore },
  ) => Promise<{ summary: string }>;
} = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-mq-process-"));
  const stateDbPath = path.join(dir, "state.db");
  const state = new SqliteSessionStateStore(stateDbPath);
  const memory = new SqliteMemoryStore(stateDbPath);
  const runs = new SqliteMemoryRunsStore(stateDbPath);
  const extractions = new SqliteMemoryExtractionStore(stateDbPath);
  const config = {
    stateDbPath,
    aiProvider: "openai",
    aiModel: "test",
    aiApiKey: "sk-test",
    ...options.configPatch,
  } as unknown as AppConfig;
  const sessions = new SessionManager({
    sandbox: new MockSandboxProvider(),
    botId: "default",
    workspaceRoot: dir,
    events: new EventBus(),
    ttlMs: 1000,
    state,
  });
  const seenThreads: string[] = [];
  const queueErrors: string[] = [];
  const notifications: unknown[] = [];
  const queue = new MemoryQueue({
    config,
    memory,
    sessions,
    runs,
    extractions,
    postFailureToSubSession: () => ({ sessionId: "memory-error", messageId: null }),
    notify: (input) => notifications.push(input),
    onQueueError: (message) => queueErrors.push(message),
    agentFactory: () => ({
      program: {},
      forward: async (input) => {
        if (options.forward) return options.forward(input, { config, memory });
        seenThreads.push(input.thread);
        return { summary: "nothing to remember" };
      },
    }),
  });
  queues.push(queue);
  stores.push(state, memory, runs, extractions);
  return { queue, sessions, memory, runs, extractions, config, seenThreads, queueErrors, notifications };
}

async function runAuto(queue: MemoryQueue): Promise<{ summary: string }> {
  const internals = queue as unknown as {
    process(data: MemoryJobData): Promise<{ summary: string }>;
  };
  return internals.process({ trigger: "auto", sourceSessionId: "main", runId: "job-run" });
}

function append(sessions: SessionManager, sessionId: string, message: BotMessage): void {
  sessions.appendMessages(sessionId, [message]);
}

function user(content: string): BotMessage {
  return { role: "user", content, createdAt: new Date().toISOString() };
}

function assistant(content: string): BotMessage {
  return { role: "assistant", kind: "text", content, createdAt: new Date().toISOString() };
}
