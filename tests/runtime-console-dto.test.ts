import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { staleRuntimeConsoleDto } from "../app/server/runtime-console.dto";
import { RuntimeStore } from "../src/runtime/runtime-store";

describe("runtime console dto", () => {
  test("builds a stale snapshot from persisted runtime state", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "aithy-console-dto-"));
    const stateDbPath = path.join(stateDir, "console-test", "state.db");

    const store = new RuntimeStore(stateDbPath);
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
      key: "local.embedding.download",
      label: "downloading local model Qwen3 Embedding 0.6B Q8_0",
      active: true,
      progress: 0.5,
    });
    store.close();

    const dto = staleRuntimeConsoleDto(
      new Error("queue-service connection closed"),
      { stateDbPath },
    );

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
      key: "local.embedding.download",
      label: "downloading local model Qwen3 Embedding 0.6B Q8_0",
      progress: 0.5,
    }));
  });
});
