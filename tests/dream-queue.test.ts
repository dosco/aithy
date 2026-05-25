import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import type { AppConfig } from "../src/config/env";
import { DreamQueue, type DreamJobData } from "../src/episodes/dream-queue";
import { SqliteEpisodeStore } from "../src/episodes/episode-store";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import type { DreamDetection, DreamDetector } from "../src/episodes/dream-detector";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { AssistantToolCallMessage, BotMessage, UserMessage } from "../src/session/types";
import { SqliteTaskStore } from "../src/tasks/task-store";

const queues: DreamQueue[] = [];
const stores: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) {
    try {
      await queue.close();
    } catch {}
  }
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
  }
  try {
    shutdownManager();
  } catch {}
});

async function setup(detector: DreamDetector, opts: { workspaceRoot?: string } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-dream-queue-"));
  const stateDbPath = path.join(dir, "state.db");
  const state = new SqliteSessionStateStore(stateDbPath);
  const episodes = new SqliteEpisodeStore(stateDbPath);
  const memory = new SqliteMemoryStore(stateDbPath);
  const tasks = new SqliteTaskStore(stateDbPath);
  const errors: string[] = [];
  const queue = new DreamQueue({
    config: { stateDbPath, workspaceRoot: opts.workspaceRoot } as AppConfig,
    episodes,
    memory,
    tasks,
    detector,
    onQueueError: (message) => errors.push(message),
  });
  queues.push(queue);
  stores.push(state, episodes, memory, tasks);
  return { state, episodes, memory, tasks, queue, errors, now: Date.now() };
}

describe("DreamQueue", () => {
  test("enqueueAuto reuses the planned task while the job is debounced", async () => {
    const fx = await setup(detector(async () => []));

    await fx.queue.enqueueAuto("main");
    await fx.queue.enqueueAuto("next");

    const active = fx.tasks.recent({ status: "active", limit: 10 })
      .filter((task) => task.kind === "memory.dream");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      status: "planned",
      dedupeKey: "memory-dream:auto",
      conversationId: "next",
      relatedSessionId: "next",
      metadata: {
        sourceSessionId: "next",
      },
    });
  });

  test("runNow reuses the planned adhoc task while the job is debounced", async () => {
    const fx = await setup(detector(async () => []));
    await stopWorker(fx.queue);

    await fx.queue.runNow();
    await fx.queue.runNow();

    const active = fx.tasks.recent({ status: "active", limit: 10 })
      .filter((task) => task.kind === "memory.dream");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      status: "planned",
      dedupeKey: "memory-dream:adhoc",
      conversationId: null,
    });
  });

  test("processes only new messages while including bounded overlap", async () => {
    let transcript = "";
    const fx = await setup(detector(async (input) => {
      transcript = input.transcript;
      return [];
    }));
    ensureSession(fx.state, "main");
    for (let i = 1; i <= 25; i += 1) fx.state.appendMessages("main", [user(`old ${i}`, fx.now + i)]);
    fx.episodes.setCursor(25);
    fx.state.appendMessages("main", [tool("sandbox.bash", { command: "bun test" }, 0, fx.now + 30_000)]);

    const result = await runProcess(fx.queue, { triggeredAt: new Date().toISOString() });

    expect(result).toMatchObject({ inspected: 1, episodes: 0, failed: 0 });
    expect(transcript).toContain("#26");
    expect(transcript).toContain("#25");
    expect(transcript).not.toContain("[context #1 ");
    expect(fx.episodes.cursor()).toBe(26);
  });

  test("skips sub-session and low-signal segments while advancing cursor", async () => {
    let calls = 0;
    const fx = await setup(detector(async () => {
      calls += 1;
      return [];
    }));
    ensureSession(fx.state, "main");
    ensureSession(fx.state, "child", "main");
    fx.state.appendMessages("child", [tool("sandbox.bash", { command: "bun test" }, 0, fx.now)]);
    fx.state.appendMessages("main", [user("hello there", fx.now + 1), assistant("hi", fx.now + 2)]);

    const result = await runProcess(fx.queue, { triggeredAt: new Date().toISOString() });

    expect(result.inspected).toBe(3);
    expect(calls).toBe(0);
    expect(fx.episodes.cursor()).toBe(3);
  });

  test("continues after per-session detector failures", async () => {
    let calls = 0;
    const fx = await setup(detector(async () => {
      calls += 1;
      if (calls === 1) throw new Error("model down");
      return [episode("Run tests")];
    }));
    ensureSession(fx.state, "one");
    ensureSession(fx.state, "two");
    fx.state.appendMessages("one", [tool("sandbox.bash", { command: "bun test" }, 0, fx.now)]);
    fx.state.appendMessages("two", [tool("sandbox.bash", { command: "bun test" }, 0, fx.now + 1)]);

    const result = await runProcess(fx.queue, { triggeredAt: new Date().toISOString() });

    expect(result).toMatchObject({ inspected: 2, episodes: 1, failed: 1 });
    expect(fx.errors[0]).toContain("failed to inspect session one");
    expect(fx.episodes.count()).toBe(1);
    expect(fx.episodes.cursor()).toBe(2);
  });

  test("processJob updates task status", async () => {
    const fx = await setup(detector(async () => [episode("Create artifact")]));
    ensureSession(fx.state, "main");
    fx.state.appendMessages("main", [tool("artifact.write", { filename: "x.txt" }, 0, fx.now)]);
    const task = fx.tasks.create({
      kind: "memory.dream",
      title: "Dream over recent work",
      conversationId: "main",
    });

    await runProcessJob(fx.queue, {
      triggeredAt: new Date().toISOString(),
      sourceSessionId: "main",
      taskId: task.id,
    });

    expect(fx.tasks.get(task.id)).toMatchObject({
      status: "completed",
      resultSummary: "inspected 1, episodes 1, failed 0",
    });
  });

  test("stores dream-derived operational agent memories", async () => {
    const fx = await setup(detector(async () => [episode("Debug postgres tests")]), {
      workspaceRoot: "/repo",
    });
    ensureSession(fx.state, "main");
    fx.state.appendMessages("main", [tool("sandbox.bash", { command: "bun test" }, 0, fx.now)]);

    const result = await runProcess(fx.queue, { triggeredAt: new Date().toISOString() });

    expect(result.episodes).toBe(1);
    const memories = await fx.memory.search(["targeted tool calls"], {
      subjects: ["agent"],
      scope: { workspaceRef: "/repo" },
    });
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({
      kind: "lesson",
      subject: "agent",
      scopeKind: "workspace",
      scopeRef: "/repo",
      guidance: "context",
      source: "dream",
    });
  });

  test("stores failed dream episodes as failure modes", async () => {
    const fx = await setup(detector(async () => [{
      ...episode("Run flaky suite"),
      outcome: "failure",
      error: "race detected",
      notes: "",
    }]), { workspaceRoot: "/repo" });
    ensureSession(fx.state, "main");
    fx.state.appendMessages("main", [tool("sandbox.bash", { command: "bun test" }, 1, fx.now)]);

    await runProcess(fx.queue, { triggeredAt: new Date().toISOString() });

    const memories = await fx.memory.search(["race detected"], {
      subjects: ["agent"],
      scope: { workspaceRef: "/repo" },
    });
    expect(memories[0]).toMatchObject({ kind: "failure_mode", subject: "agent" });
  });
});

function detector(forward: DreamDetector["forward"]): DreamDetector {
  return { program: {}, forward };
}

function episode(task: string): DreamDetection {
  return {
    task,
    approach: "Used a targeted tool call and checked the result.",
    outcome: "success",
    notes: "Targeted tool calls gave enough evidence.",
    toolNames: ["sandbox.bash"],
    error: null,
    artifactIds: [],
    importance: 0.6,
    canonicalText: task.toLowerCase(),
    evidenceStartMessageId: 1,
    evidenceEndMessageId: 1,
  };
}

function runProcess(queue: DreamQueue, data: DreamJobData): Promise<{ inspected: number; episodes: number; failed: number }> {
  return (queue as unknown as {
    process(data: DreamJobData): Promise<{ inspected: number; episodes: number; failed: number }>;
  }).process(data);
}

function stopWorker(queue: DreamQueue): Promise<void> {
  return (queue as unknown as { app: { worker: { close(): Promise<void> } } }).app.worker.close();
}

function runProcessJob(queue: DreamQueue, data: DreamJobData): Promise<{ inspected: number; episodes: number; failed: number }> {
  return (queue as unknown as {
    processJob(job: unknown): Promise<{ inspected: number; episodes: number; failed: number }>;
  }).processJob({ id: "job-1", data });
}

function ensureSession(state: SqliteSessionStateStore, id: string, parentSessionId: string | null = null): void {
  state.ensureSession({
    conversationId: id,
    name: id,
    nameSource: "manual",
    source: "test",
    parentSessionId,
    parentMessageId: null,
    now: new Date().toISOString(),
    expiresAt: new Date("2099-01-01T00:00:00Z"),
  });
}

function user(content: string, at: number): UserMessage {
  return { role: "user", content, createdAt: new Date(at).toISOString() };
}

function assistant(content: string, at: number): BotMessage {
  return { role: "assistant", kind: "text", content, createdAt: new Date(at).toISOString() };
}

function tool(toolName: string, args: unknown, exitCode: number, at: number): AssistantToolCallMessage {
  return {
    role: "assistant",
    kind: "tool_call",
    toolName,
    toolArgs: args,
    toolResult: { exitCode },
    createdAt: new Date(at).toISOString(),
  };
}
