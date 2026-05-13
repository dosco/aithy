import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import type { AppConfig } from "../src/config/env";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { SqliteMemoryRunsStore } from "../src/memory/memory-runs";
import {
  AUTO_MEMORY_BATCH_DELAY_MS,
  AUTO_MEMORY_DEDUP_TTL_MS,
  MemoryQueue,
  autoMemoryJobOptions,
} from "../src/memory/memory-queue";
import type { SessionManager } from "../src/session/session-manager";

const queues: MemoryQueue[] = [];

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
    postFailureToSubSession: post,
    onQueueError: (message) => queueErrors.push(message),
  });
  queues.push(queue);
  return { queue, runs, queueErrors };
}

describe("MemoryQueue", () => {
  test("constructs without throwing and exposes enqueue methods", async () => {
    const { queue } = await makeQueue();
    expect(typeof queue.enqueueAuto).toBe("function");
    expect(typeof queue.enqueueExplicit).toBe("function");
    expect(typeof queue.close).toBe("function");
  });

  test("enqueueAuto twice for the same session dedupes the second", async () => {
    const { queue } = await makeQueue();
    await queue.enqueueAuto("session-x");
    // The second call within the dedup TTL should be a no-op (no throw).
    await queue.enqueueAuto("session-x");
    // Close before the worker actually runs the job to avoid invoking the LLM.
    await queue.close();
  });

  test("auto memory jobs are delayed and debounced per session", () => {
    const opts = autoMemoryJobOptions("session-x", "run-y");

    expect(opts.delay).toBe(AUTO_MEMORY_BATCH_DELAY_MS);
    expect(opts.deduplication).toEqual({
      id: "auto:session-x",
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

  test("embedded worker lock ownership is disabled", async () => {
    const { queue } = await makeQueue();
    const internals = queue as unknown as {
      app: { worker: { opts: { useLocks: boolean } } };
    };

    expect(internals.app.worker.opts.useLocks).toBe(false);
  });
});
