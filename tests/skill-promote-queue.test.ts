import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import type { AppConfig } from "../src/config/env";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { AssistantToolCallMessage, UserMessage } from "../src/session/types";
import { SqliteSkillCandidateStore } from "../src/skills/candidate-store";
import { SkillCandidateQueue, type SkillCandidateQueueDeps } from "../src/skills/candidate-queue";
import type { SkillCandidateDetection } from "../src/skills/candidate-detector";
import { SqliteTaskStore } from "../src/tasks/task-store";

const queues: SkillCandidateQueue[] = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) {
    try {
      await queue.close();
    } catch {}
  }
  try {
    shutdownManager();
  } catch {}
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-candidate-queue-"));
  const stateDbPath = path.join(dir, "state.db");
  const state = new SqliteSessionStateStore(stateDbPath);
  const now = Date.now();
  state.ensureSession({
    conversationId: "parent",
    name: "Parent",
    nameSource: "generated",
    source: "test",
    now: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000),
  });
  const candidates = new SqliteSkillCandidateStore(stateDbPath);
  const tasks = new SqliteTaskStore(stateDbPath);
  const posts: Array<{ parentSessionId: string; parentMessageId?: number | null; text: string; name?: string }> = [];
  const notifications: Array<{ title: string; link?: string | null }> = [];
  return { stateDbPath, state, candidates, tasks, posts, notifications, now };
}

function makeQueue(input: Awaited<ReturnType<typeof setup>>, detector: SkillCandidateQueueDeps["detector"]) {
  const queue = new SkillCandidateQueue({
    config: { stateDbPath: input.stateDbPath } as AppConfig,
    candidates: input.candidates,
    tasks: input.tasks,
    detector,
    postToSubSession: (post) => {
      input.posts.push(post);
      return { sessionId: `sub-${input.posts.length}`, messageId: input.posts.length };
    },
    notify: (notification) => {
      input.notifications.push({ title: notification.title, link: notification.link });
    },
  });
  queues.push(queue);
  return queue as unknown as {
    enqueueAuto(): Promise<void>;
    runNow(): Promise<void>;
    process(data: { triggeredAt: string }): Promise<{ inspected: number; candidates: number; suggested: number }>;
  };
}

function stopWorker(queue: unknown): Promise<void> {
  return (queue as { app: { worker: { close(): Promise<void> } } }).app.worker.close();
}

describe("SkillCandidateQueue", () => {
  test("enqueueAuto reuses the planned task while the job is debounced", async () => {
    const fixture = await setup();
    const queue = makeQueue(fixture, detector([]));

    await queue.enqueueAuto();
    await queue.enqueueAuto();

    const active = fixture.tasks.recent({ status: "active", limit: 10 })
      .filter((task) => task.kind === "skill.candidate");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      status: "planned",
      dedupeKey: "skill-candidates:auto",
      conversationId: null,
      metadata: {},
    });
  });

  test("runNow reuses the planned adhoc task while the job is debounced", async () => {
    const fixture = await setup();
    const queue = makeQueue(fixture, detector([]));
    await stopWorker(queue);

    await queue.runNow();
    await queue.runNow();

    const active = fixture.tasks.recent({ status: "active", limit: 10 })
      .filter((task) => task.kind === "skill.candidate");
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      status: "planned",
      dedupeKey: "skill-candidates:adhoc",
      conversationId: null,
      metadata: {},
    });
  });

  test("stores a high-confidence candidate and suggests it to the user", async () => {
    const fixture = await setup();
    fixture.state.appendMessages("parent", [
      user("Let's make the bun test flow reusable.", fixture.now),
      tool("sandbox.bash", { command: "bun test", cwd: "/workspace" }, 0, fixture.now + 1000),
    ]);
    fixture.state.close();

    const queue = makeQueue(fixture, detector([{
      title: "Bun Test Workflow",
      description: "Run the repo's Bun test workflow.",
      canonicalText: "run bun tests for this repo",
      rationale: "The user asked to make the workflow reusable.",
      confidence: 0.91,
      tags: "testing",
      existingCandidateId: null,
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 2,
    }]));
    const result = await queue.process({ triggeredAt: new Date().toISOString() });

    expect(result).toMatchObject({ inspected: 2, candidates: 1, suggested: 1 });
    expect(fixture.candidates.cursor()).toBe(2);
    expect(fixture.posts[0].text).toContain("I noticed this looks reusable: Bun Test Workflow.");
    expect(fixture.notifications).toEqual([
      { title: "Create a skill for \"Bun Test Workflow\"?", link: "/chat/sub-1" },
    ]);
    expect(fixture.candidates.pendingBySubSession("sub-1")?.status).toBe("suggested");
  });

  test("processes only new messages while including bounded overlap", async () => {
    const fixture = await setup();
    const oldMessages: UserMessage[] = Array.from({ length: 25 }, (_, index) =>
      user(`old ${index + 1}`, fixture.now + index)
    );
    fixture.state.appendMessages("parent", oldMessages);
    fixture.candidates.setCursor(25);
    fixture.state.appendMessages("parent", [
      tool("sandbox.bash", { command: "bun test" }, 0, fixture.now + 30_000),
    ]);
    fixture.state.close();

    let transcript = "";
    const queue = makeQueue(fixture, {
      program: {},
      forward: async (input) => {
        transcript = input.transcript;
        return [];
      },
    });
    const result = await queue.process({ triggeredAt: new Date().toISOString() });

    expect(result.inspected).toBe(1);
    expect(transcript).toContain("#26");
    expect(transcript).toContain("#25");
    expect(transcript).not.toContain("[context #1 ");
    expect(fixture.candidates.cursor()).toBe(26);
  });

  test("feeds developing candidates into later detector runs", async () => {
    const fixture = await setup();
    const open = fixture.candidates.upsertCandidate({
      title: "Repo Test Flow",
      description: "Maybe a reusable test flow.",
      canonicalText: "repo test flow",
      rationale: "Initial weak signal.",
      confidence: 0.4,
      tags: null,
      sourceSessionId: "parent",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 1,
    });
    fixture.state.appendMessages("parent", [
      tool("sandbox.bash", { command: "bun test" }, 0, fixture.now),
    ]);
    fixture.state.close();

    let openIds: string[] = [];
    const queue = makeQueue(fixture, {
      program: {},
      forward: async (input) => {
        openIds = input.openCandidates.map((candidate) => candidate.id);
        return [{
          title: "Repo Test Flow",
          description: "Run the repo test flow.",
          canonicalText: "repo test flow",
          rationale: "The workflow matured.",
          confidence: 0.8,
          tags: "testing",
          existingCandidateId: open.id,
          evidenceStartMessageId: 1,
          evidenceEndMessageId: 1,
        }];
      },
    });
    await queue.process({ triggeredAt: new Date().toISOString() });

    expect(openIds).toEqual([open.id]);
    expect(fixture.candidates.get(open.id)?.seenCount).toBe(2);
  });

  test("gated low-signal segments advance the cursor without detector calls", async () => {
    const fixture = await setup();
    fixture.state.appendMessages("parent", [user("hello there", fixture.now)]);
    fixture.state.close();
    let calls = 0;
    const queue = makeQueue(fixture, {
      program: {},
      forward: async () => {
        calls += 1;
        return [];
      },
    });
    const result = await queue.process({ triggeredAt: new Date().toISOString() });

    expect(result).toMatchObject({ inspected: 1, candidates: 0, suggested: 0 });
    expect(calls).toBe(0);
    expect(fixture.candidates.cursor()).toBe(1);
  });
});

function detector(detections: SkillCandidateDetection[]): SkillCandidateQueueDeps["detector"] {
  return {
    program: {},
    forward: async () => detections,
  };
}

function user(content: string, at: number): UserMessage {
  return {
    role: "user",
    content,
    createdAt: new Date(at).toISOString(),
  };
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
