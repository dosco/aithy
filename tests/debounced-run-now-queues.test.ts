import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import type { AppConfig } from "../src/config/env";
import { MemoryConsolidateQueue } from "../src/memory/consolidate-queue";
import { MemoryExpiryQueue } from "../src/memory/expiry-queue";
import { SqliteMemoryRunsStore } from "../src/memory/memory-runs";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { SkillPromoteQueue } from "../src/skills/promote-queue";
import { SqliteSkillPromotionStore } from "../src/skills/promote-store";
import { SqliteSkillsStore } from "../src/skills/skills-store";
import { SqliteTaskStore } from "../src/tasks/task-store";

const queues: Array<{ close(): Promise<void> }> = [];
const stores: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.close().catch(() => {});
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
  }
  try {
    shutdownManager();
  } catch {}
});

describe("debounced runNow queues", () => {
  test("memory consolidation reuses the planned adhoc task", async () => {
    const fx = await fixture();
    const runs = new SqliteMemoryRunsStore(fx.stateDbPath);
    stores.push(runs);
    const queue = new MemoryConsolidateQueue({
      config: fx.config,
      memory: fx.memory,
      runs,
      tasks: fx.tasks,
    });
    queues.push(queue);
    await stopWorker(queue);

    await queue.runNow();
    await queue.runNow();

    expect(activeTasks(fx.tasks, "memory.consolidate")).toEqual([
      expect.objectContaining({
        status: "planned",
        dedupeKey: "consolidate:adhoc",
        conversationId: null,
      }),
    ]);
  });

  test("memory expiry reuses the planned adhoc task", async () => {
    const fx = await fixture();
    const queue = new MemoryExpiryQueue({
      config: fx.config,
      memory: fx.memory,
      tasks: fx.tasks,
    });
    queues.push(queue);
    await stopWorker(queue);

    await queue.runNow();
    await queue.runNow();

    expect(activeTasks(fx.tasks, "memory.expiry")).toEqual([
      expect.objectContaining({
        status: "planned",
        dedupeKey: "expiry:adhoc",
        conversationId: null,
      }),
    ]);
  });

  test("skill promotion reuses the planned adhoc task", async () => {
    const fx = await fixture();
    const skills = new SqliteSkillsStore(fx.stateDbPath);
    const promotions = new SqliteSkillPromotionStore(fx.stateDbPath);
    stores.push(skills, promotions);
    const queue = new SkillPromoteQueue({
      config: fx.config,
      skills,
      promotions,
      tasks: fx.tasks,
      postToSubSession: () => ({ sessionId: "sub", messageId: 1 }),
      notify: () => {},
    });
    queues.push(queue);
    await stopWorker(queue);

    await queue.runNow();
    await queue.runNow();

    expect(activeTasks(fx.tasks, "skill.promote")).toEqual([
      expect.objectContaining({
        status: "planned",
        dedupeKey: "skill.promote:adhoc",
        conversationId: null,
      }),
    ]);
  });
});

async function fixture(): Promise<{
  stateDbPath: string;
  config: AppConfig;
  memory: SqliteMemoryStore;
  tasks: SqliteTaskStore;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-debounced-run-now-"));
  const stateDbPath = path.join(dir, "state.db");
  const memory = new SqliteMemoryStore(stateDbPath);
  const tasks = new SqliteTaskStore(stateDbPath);
  stores.push(memory, tasks);
  return {
    stateDbPath,
    config: { stateDbPath } as AppConfig,
    memory,
    tasks,
  };
}

function activeTasks(tasks: SqliteTaskStore, kind: ReturnType<SqliteTaskStore["recent"]>[number]["kind"]) {
  return tasks.recent({ status: "active", limit: 10 }).filter((task) => task.kind === kind);
}

function stopWorker(queue: unknown): Promise<void> {
  return (queue as { app: { worker: { close(): Promise<void> } } }).app.worker.close();
}
