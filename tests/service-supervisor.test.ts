import { describe, expect, test } from "bun:test";
import { RuntimeServiceSupervisor } from "../src/runtime/supervisor/service-supervisor";
import type { QueueServiceClient } from "../src/runtime/services/queue/client";
import type { RuntimeTopology } from "../src/runtime/topology";

const devTopology: RuntimeTopology = {
  kind: "dev",
  queuePlacement: "process",
  agentPlacement: "process",
};

describe("RuntimeServiceSupervisor", () => {
  test("reports service spawn failures without throwing from start", async () => {
    const originalSpawn = Bun.spawn;
    const queue = recordingQueue();
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = (() => {
      throw new Error("spawn denied");
    }) as typeof Bun.spawn;
    try {
      const supervisor = new RuntimeServiceSupervisor({
        queue: queue.client,
        queueUrl: "ws://127.0.0.1:1/runtime",
        topology: devTopology,
        services: [
          { role: "local-inference-worker", entry: "src/runtime/services/local-inference/worker.ts" },
        ],
      });

      expect(() => supervisor.start()).not.toThrow();
      await Promise.resolve();
      expect(queue.logs.at(-1)?.message).toBe("local-inference-worker failed to start: spawn denied");
      expect(queue.heartbeats.at(-1)).toMatchObject({
        role: "local-inference-worker",
        state: "failed",
        detail: { error: "spawn denied" },
      });
      await supervisor.close();
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("treats shutdown heartbeats as best-effort when no child process exists", async () => {
    const supervisor = new RuntimeServiceSupervisor({
      queue: rejectingQueue(),
      queueUrl: "ws://127.0.0.1:1/runtime",
      topology: devTopology,
      services: [
        { role: "agent-worker", entry: "src/runtime/services/agent/worker.ts", enabled: false },
      ],
    });

    await expect(supervisor.close()).resolves.toBeUndefined();
  });

  test("restarts a live child when central health reports failed by default", async () => {
    const originalSpawn = Bun.spawn;
    const queue = recordingQueue({
      role: "agent-worker",
      state: "failed",
      pid: 42,
      lastSeenAt: new Date().toISOString(),
      detail: { error: "model load failed" },
    });
    const kills: string[] = [];
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = (() => ({
      pid: 42,
      stdout: null,
      stderr: null,
      exited: new Promise(() => {}),
      kill: (signal?: string) => {
        kills.push(signal ?? "SIGTERM");
      },
    })) as unknown as typeof Bun.spawn;
    try {
      const supervisor = new RuntimeServiceSupervisor({
        queue: queue.client,
        queueUrl: "ws://127.0.0.1:1/runtime",
        topology: devTopology,
        healthCheckIntervalMs: 60_000,
        services: [
          { role: "agent-worker", entry: "src/runtime/services/agent/worker.ts" },
        ],
      });

      supervisor.start();
      await supervisor.checkHealth();
      expect(kills).toContain("SIGTERM");
      expect(queue.logs.at(-1)?.message).toBe("agent-worker failed healthcheck; restarting");
      expect(queue.heartbeats.at(-1)).toMatchObject({
        role: "agent-worker",
        state: "failed",
        detail: {
          reason: "reported failed",
          restartInMs: 500,
        },
      });
      await supervisor.close();
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("does not restart a live child that reports degraded", async () => {
    const originalSpawn = Bun.spawn;
    const queue = recordingQueue({
      role: "local-inference-worker",
      state: "degraded",
      pid: 42,
      lastSeenAt: new Date().toISOString(),
      detail: { error: "llama-server was not found" },
    });
    const kills: string[] = [];
    let resolveExit: (code: number) => void = () => {};
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = (() => ({
      pid: 42,
      stdout: null,
      stderr: null,
      exited,
      kill: (signal?: string) => {
        kills.push(signal ?? "SIGTERM");
        resolveExit(0);
      },
    })) as unknown as typeof Bun.spawn;
    try {
      const supervisor = new RuntimeServiceSupervisor({
        queue: queue.client,
        queueUrl: "ws://127.0.0.1:1/runtime",
        topology: devTopology,
        healthCheckIntervalMs: 60_000,
        services: [
          { role: "local-inference-worker", entry: "src/runtime/services/local-inference/worker.ts" },
        ],
      });

      supervisor.start();
      await supervisor.checkHealth();
      expect(kills).toEqual([]);
      expect(queue.logs.map((log) => log.message)).not.toContain("local-inference-worker failed healthcheck; restarting");
      await supervisor.close();
      expect(kills).toContain("SIGTERM");
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });
});

function rejectingQueue(): QueueServiceClient {
  return {
    heartbeat: async () => {
      throw new Error("queue-service connection closed");
    },
    appendLog: async () => {
      throw new Error("queue-service connection closed");
    },
  } as unknown as QueueServiceClient;
}

function recordingQueue(serviceStatus?: unknown) {
  const heartbeats: Array<{ role: string; state: string; detail?: unknown }> = [];
  const logs: Array<{ message: string }> = [];
  return {
    heartbeats,
    logs,
    client: {
      heartbeat: async (role: string, state: string, detail?: unknown) => {
        heartbeats.push({ role, state, detail });
      },
      appendLog: async (input: { message: string }) => {
        logs.push(input);
      },
      service: async () => serviceStatus,
    } as unknown as QueueServiceClient,
  };
}
