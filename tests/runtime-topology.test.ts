import { describe, expect, test } from "bun:test";
import { runtimeTopologyForConfig } from "../src/runtime/topology";
import { QueueServiceRuntime } from "../src/runtime/services/queue/runtime";
import { managedServicesForTopology } from "../src/runtime/supervisor/runtime-services";
import { startInProcessAgentService } from "../src/runtime/supervisor/in-process-agent";
import type { QueueServiceClient } from "../src/runtime/services/queue/client";
import type { AgentWorkerRuntime } from "../src/runtime/services/agent/runtime";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("runtime topology", () => {
  test("keeps dev services process-isolated by default", () => {
    expect(runtimeTopologyForConfig(undefined)).toMatchObject({
      kind: "dev",
      queuePlacement: "process",
      agentPlacement: "process",
    });
  });

  test("uses coordinator placement for packaged releases", () => {
    expect(runtimeTopologyForConfig({
      kind: "packaged",
      serviceScriptRoot: "/opt/aithy/app/workers",
    })).toMatchObject({
      kind: "packaged",
      queuePlacement: "coordinator",
      agentPlacement: "coordinator",
      serviceScriptRoot: "/opt/aithy/app/workers",
    });
  });

  test("places only sandbox and local inference in external packaged services", () => {
    const dev = managedServicesForTopology(runtimeTopologyForConfig(undefined)).map((service) => service.role);
    const packaged = managedServicesForTopology(runtimeTopologyForConfig({ kind: "packaged" })).map((service) => service.role);
    expect(dev).toEqual(["agent-worker", "sandbox-worker", "local-inference-worker"]);
    expect(packaged).toEqual(["sandbox-worker", "local-inference-worker"]);
  });

  test("starts coordinator agent with a distinct agent-worker queue client", async () => {
    const webQueue = recordingQueue();
    const connected: unknown[] = [];
    let createdWithQueue: QueueServiceClient | undefined;
    let createdOptions: { ownsBunqueueManager?: boolean } | undefined;
    let started = false;
    let shutDown = false;

    const handle = await startInProcessAgentService({
      queue: webQueue,
      queueUrl: "ws://127.0.0.1:1/runtime?token=test",
    }, {
      connectQueue: async (input) => {
        connected.push(input);
        return {
          role: input.role,
          close: () => {},
        } as unknown as QueueServiceClient;
      },
      createAgent: async (queue, options) => {
        createdWithQueue = queue;
        createdOptions = options;
        return {
          start: () => {
            started = true;
          },
          shutdown: async () => {
            shutDown = true;
          },
        } as unknown as AgentWorkerRuntime;
      },
    });

    expect(webQueue.heartbeats.at(-1)).toMatchObject({
      role: "agent-worker",
      state: "starting",
      detail: { placement: "coordinator" },
    });
    expect(connected).toEqual([{
      url: "ws://127.0.0.1:1/runtime?token=test",
      role: "agent-worker",
      placement: "coordinator",
    }]);
    expect(createdWithQueue).not.toBe(webQueue);
    expect(createdWithQueue?.role).toBe("agent-worker");
    expect(createdOptions).toEqual({ ownsBunqueueManager: false });
    expect(started).toBe(true);

    await handle.close();
    expect(shutDown).toBe(true);
  });

  test("creates an in-process queue without reading or mutating queue env", async () => {
    const originalPort = process.env.AITHY_QUEUE_PORT;
    const originalToken = process.env.AITHY_QUEUE_TOKEN;
    delete process.env.AITHY_QUEUE_PORT;
    delete process.env.AITHY_QUEUE_TOKEN;
    const root = await mkdtemp(path.join(tmpdir(), "aithy-queue-runtime-"));
    try {
      const runtime = QueueServiceRuntime.create({
        port: 1,
        token: "test-token",
        placement: "coordinator",
        stateDbPath: path.join(root, "state.db"),
      });
      runtime.stop();
      expect(process.env.AITHY_QUEUE_PORT).toBeUndefined();
      expect(process.env.AITHY_QUEUE_TOKEN).toBeUndefined();
    } finally {
      restoreEnv("AITHY_QUEUE_PORT", originalPort);
      restoreEnv("AITHY_QUEUE_TOKEN", originalToken);
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function recordingQueue(): QueueServiceClient & {
  heartbeats: Array<{ role: string; state: string; detail?: unknown }>;
} {
  const heartbeats: Array<{ role: string; state: string; detail?: unknown }> = [];
  return {
    heartbeats,
    role: "web",
    heartbeat: async (role: string, state: string, detail?: unknown) => {
      heartbeats.push({ role, state, detail });
    },
    appendLog: async () => {},
  } as unknown as QueueServiceClient & {
    heartbeats: Array<{ role: string; state: string; detail?: unknown }>;
  };
}
