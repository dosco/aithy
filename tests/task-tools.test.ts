import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createAgentTools } from "../src/agent/tools";
import { loadConfig } from "../src/config/env";
import { SqliteTaskStore } from "../src/tasks/task-store";

describe("tasks.getTasks tool", () => {
  test("returns redacted active and not-active task summaries", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-task-tool-"));
    const tasks = new SqliteTaskStore(path.join(dir, "state.db"));
    const active = tasks.create({
      kind: "chat.turn",
      title: "Write report",
      conversationId: "c1",
      metadata: { text: "private prompt" },
    });
    const failed = tasks.create({
      kind: "chat.turn",
      title: "Failed report",
      conversationId: "c1",
      metadata: { text: "retry prompt" },
    });
    tasks.update(failed.id, { status: "failed", errorSummary: "model error" });

    const tool = createAgentTools({
      session: { conversationId: "c1" },
      tasks,
    } as any, { ...loadConfig(), sandboxProvider: "disabled" })
      .find((item: any) => item.namespace === "tasks" && item.name === "getTasks") as any;

    expect(tool).toBeTruthy();
    const activeResult = await tool.func({ status: "active" });
    const activeTasks = activeResult.tasks;
    expect(activeTasks).toEqual([
      expect.objectContaining({ id: active.id, title: "Write report", status: "planned" }),
    ]);
    expect(JSON.stringify(activeTasks)).not.toContain("private prompt");
    expect(activeTasks[0]).not.toHaveProperty("createdAt");
    expect(activeTasks[0]).not.toHaveProperty("runtimeCommandId");
    expect(activeTasks[0]).not.toHaveProperty("errorSummary");

    const inactiveResult = await tool.func({ status: "not-active" });
    const inactiveTasks = inactiveResult.tasks;
    expect(inactiveTasks).toEqual([
      expect.objectContaining({ id: failed.id, status: "failed", canRetry: true }),
    ]);
    tasks.close();
  });
});
