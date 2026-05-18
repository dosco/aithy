import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteTaskStore } from "../src/tasks/task-store";

describe("SqliteTaskStore", () => {
  test("records lifecycle history and summarizes retry/cancel affordances", async () => {
    const store = await makeStore();
    const task = store.create({
      kind: "chat.turn",
      title: "Summarize repo",
      conversationId: "c1",
      metadata: { text: "summarize", secret: "not returned" },
    });

    store.update(task.id, { status: "running", reason: "Agent is working" });
    const failed = store.update(task.id, {
      status: "failed",
      reason: "Agent failed",
      errorSummary: "boom",
    });

    expect(failed).toMatchObject({ status: "failed", errorSummary: "boom" });
    expect(store.events(task.id).map((event) => event.status)).toEqual([
      "planned",
      "running",
      "failed",
    ]);
    const summaries = store.summariesForAgent({ status: "not-active", conversationId: "c1" });
    expect(summaries).toEqual([
      expect.objectContaining({
        id: task.id,
        status: "failed",
        reason: "boom",
        errorSummary: "boom",
        resultSummary: null,
        conversationId: "c1",
        relatedSessionId: "c1",
        attempt: 1,
        createdAt: task.createdAt,
        startedAt: expect.any(String),
        completedAt: expect.any(String),
        canRetry: true,
        canCancel: false,
      }),
    ]);
    expect(JSON.stringify(summaries)).not.toContain("not returned");
    store.close();
  });

  test("filters active and global background tasks for agent visibility", async () => {
    const store = await makeStore();
    const sessionTask = store.create({
      kind: "chat.turn",
      title: "Current chat",
      conversationId: "c1",
    });
    const otherTask = store.create({
      kind: "chat.turn",
      title: "Other chat",
      conversationId: "c2",
    });
    const globalTask = store.create({
      kind: "memory.expiry",
      title: "Cleanup",
      conversationId: null,
    });
    store.update(otherTask.id, { status: "completed", reason: "Done" });

    const active = store.summariesForAgent({ status: "active", conversationId: "c1" });
    expect(active.map((task) => task.id)).toContain(sessionTask.id);
    expect(active.map((task) => task.id)).toContain(globalTask.id);
    expect(active.map((task) => task.id)).not.toContain(otherTask.id);
    store.close();
  });

  test("createOrReusePlanned creates and then reuses planned dedupe tasks", async () => {
    const store = await makeStore();
    const first = store.createOrReusePlanned({
      dedupeKey: "memory:auto",
      create: {
        kind: "memory.auto",
        title: "Update memory",
        conversationId: "s1",
        reason: "Queued",
        metadata: { sourceSessionId: "s1" },
      },
      update: {
        conversationId: "s2",
        relatedSessionId: "s2",
        reason: "Queued again",
        metadata: { sourceSessionId: "s2" },
      },
    });
    const second = store.createOrReusePlanned({
      dedupeKey: "memory:auto",
      create: {
        kind: "memory.auto",
        title: "Update memory",
        conversationId: "s3",
        reason: "Should not create",
      },
      update: {
        conversationId: "s2",
        relatedSessionId: "s2",
        reason: "Queued again",
        metadata: { sourceSessionId: "s2" },
      },
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.task.id).toBe(first.task.id);
    expect(second.task).toMatchObject({
      dedupeKey: "memory:auto",
      conversationId: "s2",
      relatedSessionId: "s2",
      reason: "Queued again",
      metadata: { sourceSessionId: "s2" },
    });
    store.close();
  });

  test("createOrReusePlanned does not reuse running or terminal tasks", async () => {
    const store = await makeStore();
    const first = store.createOrReusePlanned({
      dedupeKey: "memory:auto",
      create: { kind: "memory.auto", title: "Update memory" },
    }).task;
    store.update(first.id, { status: "running", reason: "Working" });

    const second = store.createOrReusePlanned({
      dedupeKey: "memory:auto",
      create: { kind: "memory.auto", title: "Update memory again" },
    }).task;
    expect(second.id).not.toBe(first.id);
    store.update(second.id, { status: "completed", reason: "Done" });

    const third = store.createOrReusePlanned({
      dedupeKey: "memory:auto",
      create: { kind: "memory.auto", title: "Update memory after completion" },
    }).task;
    expect(third.id).not.toBe(second.id);
    expect(third.status).toBe("planned");
    store.close();
  });

  test("createOrReusePlanned handles duplicate insert races by returning the planned task", async () => {
    const store = await makeStore();
    const existing = store.create({
      kind: "memory.auto",
      title: "Already queued",
      dedupeKey: "race:auto",
    });
    const original = (store as unknown as {
      getPlannedByDedupeKey: (dedupeKey: string) => unknown;
    }).getPlannedByDedupeKey.bind(store);
    let calls = 0;
    (store as unknown as {
      getPlannedByDedupeKey: (dedupeKey: string) => unknown;
    }).getPlannedByDedupeKey = (dedupeKey: string) => {
      calls += 1;
      return calls === 1 ? null : original(dedupeKey);
    };

    const result = store.createOrReusePlanned({
      dedupeKey: "race:auto",
      create: {
        kind: "memory.auto",
        title: "Raced task",
      },
      update: {
        reason: "Still queued",
      },
    });

    expect(result.reused).toBe(true);
    expect(result.task.id).toBe(existing.id);
    expect(result.task.reason).toBe("Still queued");
    store.close();
  });
});

async function makeStore(): Promise<SqliteTaskStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-task-store-"));
  return new SqliteTaskStore(path.join(dir, "state.db"));
}
