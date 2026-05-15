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
    expect(store.summariesForAgent({ status: "not-active", conversationId: "c1" })).toEqual([
      expect.objectContaining({
        id: task.id,
        status: "failed",
        reason: "boom",
        canRetry: true,
        canCancel: false,
      }),
    ]);
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
});

async function makeStore(): Promise<SqliteTaskStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-task-store-"));
  return new SqliteTaskStore(path.join(dir, "state.db"));
}

