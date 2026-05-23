import { AgentWorkerRuntime } from "../services/agent/runtime";
import { QueueServiceClient } from "../services/queue/client";

export interface InProcessAgentHandle {
  close(): Promise<void>;
}

interface InProcessAgentDeps {
  connectQueue?: typeof QueueServiceClient.connect;
  createAgent?: typeof AgentWorkerRuntime.create;
}

export async function startInProcessAgentService(input: {
  queue: QueueServiceClient;
  queueUrl: string;
}, deps: InProcessAgentDeps = {}): Promise<InProcessAgentHandle> {
  const connectQueue = deps.connectQueue ?? QueueServiceClient.connect;
  const createAgent = deps.createAgent ?? AgentWorkerRuntime.create;
  let agentClient: QueueServiceClient | undefined;
  try {
    await input.queue.heartbeat("agent-worker", "starting", { placement: "coordinator" });
    agentClient = await connectQueue({
      url: input.queueUrl,
      role: "agent-worker",
      placement: "coordinator",
    });
    const runtime = await createAgent(agentClient, {
      ownsBunqueueManager: false,
    });
    runtime.start();
    return {
      close: () => runtime.shutdown(),
    };
  } catch (error) {
    agentClient?.close();
    const message = errorMessage(error);
    await bestEffort(input.queue.appendLog({
      role: "web",
      level: "error",
      source: "coordinator",
      message: `agent-worker failed to start: ${message}`,
    }));
    await bestEffort(input.queue.heartbeat("agent-worker", "failed", {
      placement: "coordinator",
      error: message,
    }));
    return {
      close: async () => {
        agentClient?.close();
      },
    };
  }
}

async function bestEffort(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
