import { describe, expect, test } from "bun:test";
import { RuntimeServiceSupervisor } from "../src/runtime/supervisor/service-supervisor";
import type { QueueServiceClient } from "../src/runtime/services/queue/client";

describe("RuntimeServiceSupervisor", () => {
  test("treats shutdown heartbeats as best-effort when no child process exists", async () => {
    const supervisor = new RuntimeServiceSupervisor({
      queue: rejectingQueue(),
      queueUrl: "ws://127.0.0.1:1/runtime",
      services: [
        { role: "agent-worker", entry: "src/runtime/services/agent/worker.ts", enabled: false },
      ],
    });

    await expect(supervisor.close()).resolves.toBeUndefined();
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
