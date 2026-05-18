import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { staleRuntimeConsoleDto } from "../app/server/runtime-console.dto";
import { RuntimeStore } from "../src/runtime/runtime-store";

describe("runtime console dto", () => {
  test("builds a stale snapshot from persisted runtime state", async () => {
    const previousStateDir = process.env.AITHY_STATE_DIR;
    const previousBotId = process.env.AITHY_BOT_ID;
    const stateDir = await mkdtemp(path.join(tmpdir(), "aithy-console-dto-"));
    process.env.AITHY_STATE_DIR = stateDir;
    process.env.AITHY_BOT_ID = "console-test";

    const store = new RuntimeStore(path.join(stateDir, "console-test", "state.db"));
    store.heartbeat("sandbox-worker", "failed", { disconnected: true });
    store.appendLog({
      role: "sandbox-worker",
      level: "error",
      source: "supervisor",
      message: "sandbox-worker exited with code 1",
    });
    store.appendQueueStatus({
      id: "agent.chat",
      ownerRole: "queue-service",
      state: "blocked",
      depth: 1,
      activeCount: 0,
      blockedReason: "waiting for sandbox-worker: failed",
      dependencyRoles: ["sandbox-worker"],
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    store.appendEvent({
      type: "setup-status",
      id: "setup-1",
      createdAt: "2026-05-14T00:00:01.000Z",
      key: "memory.embedder",
      label: "downloading memory model Xenova/all-MiniLM-L6-v2",
      active: true,
      progress: 0.5,
    });
    store.close();

    try {
      const dto = staleRuntimeConsoleDto(new Error("queue-service connection closed"));

      expect(dto.snapshotState).toBe("stale");
      expect(dto.snapshotError).toBe("queue-service connection closed");
      expect(dto.services).toContainEqual(expect.objectContaining({
        role: "sandbox-worker",
        state: "failed",
      }));
      expect(dto.logs[0]).toMatchObject({
        role: "web",
        level: "warn",
        source: "console",
      });
      expect(dto.queues).toContainEqual(expect.objectContaining({
        id: "agent.chat",
        state: "blocked",
      }));
      expect(dto.setupStatuses).toContainEqual(expect.objectContaining({
        key: "memory.embedder",
        label: "downloading memory model Xenova/all-MiniLM-L6-v2",
        progress: 0.5,
      }));
    } finally {
      if (previousStateDir === undefined) delete process.env.AITHY_STATE_DIR;
      else process.env.AITHY_STATE_DIR = previousStateDir;
      if (previousBotId === undefined) delete process.env.AITHY_BOT_ID;
      else process.env.AITHY_BOT_ID = previousBotId;
    }
  });
});
