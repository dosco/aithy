import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import type { AppConfig } from "../src/config/env";
import { MemoryExpiryQueue } from "../src/memory/expiry-queue";
import { SqliteMemoryStore } from "../src/memory/memory-store";

const queues: MemoryExpiryQueue[] = [];

afterEach(async () => {
  for (const q of queues.splice(0)) await q.close().catch(() => {});
  try {
    shutdownManager();
  } catch {
    // ignore
  }
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-memory-expiry-"));
  const stateDbPath = path.join(dir, "state.db");
  const memory = new SqliteMemoryStore(stateDbPath);
  const notifications: string[] = [];
  const queue = new MemoryExpiryQueue({
    config: { stateDbPath } as AppConfig,
    memory,
    notify: (input) => notifications.push(`${input.title}: ${input.body ?? ""}`),
  });
  queues.push(queue);
  return { memory, queue, notifications };
}

describe("MemoryExpiryQueue", () => {
  test("schedules a daily expiry job", async () => {
    const { queue } = await fixture();
    await queue.schedule();
    expect(typeof queue.close).toBe("function");
  });

  test("process deletes expired memories and reports the deleted count", async () => {
    const { memory, queue, notifications } = await fixture();
    memory.upsert({
      kind: "event",
      title: "expired",
      body: "An expired event.",
      validUntil: "2000-01-01",
    });
    memory.upsert({
      kind: "fact",
      title: "durable",
      body: "A durable fact.",
    });

    const result = (queue as unknown as { process: () => { deleted: number } }).process();

    expect(result.deleted).toBe(1);
    expect(memory.count()).toBe(1);
    expect(notifications[0]).toContain("Deleted 1 expired memory");
  });
});
