import type { RuntimeTopology } from "../topology";
import type { QueueServiceClient } from "../services/queue/client";
import { RuntimeServiceSupervisor, type ManagedServiceConfig } from "./service-supervisor";
import { startInProcessAgentService, type InProcessAgentHandle } from "./in-process-agent";

export interface RuntimeServicesHandle {
  close(): Promise<void>;
}

export async function startRuntimeServices(input: {
  queue: QueueServiceClient;
  queueUrl: string;
  topology: RuntimeTopology;
}): Promise<RuntimeServicesHandle> {
  const agent = input.topology.agentPlacement === "coordinator"
    ? await startInProcessAgentService({ queue: input.queue, queueUrl: input.queueUrl })
    : undefined;

  const supervisor = new RuntimeServiceSupervisor({
    queue: input.queue,
    queueUrl: input.queueUrl,
    topology: input.topology,
    services: managedServicesForTopology(input.topology),
  });
  supervisor.start();

  return {
    close: () => closeRuntimeServices(agent, supervisor),
  };
}

export function managedServicesForTopology(topology: RuntimeTopology): ManagedServiceConfig[] {
  return [
    ...(topology.agentPlacement === "process"
      ? [{ role: "agent-worker" as const, entry: "src/runtime/services/agent/worker.ts" }]
      : []),
    { role: "sandbox-worker", entry: "src/runtime/services/sandbox/worker.ts" },
    { role: "local-inference-worker", entry: "src/runtime/services/local-inference/worker.ts" },
  ];
}

async function closeRuntimeServices(
  agent: InProcessAgentHandle | undefined,
  supervisor: RuntimeServiceSupervisor,
): Promise<void> {
  let firstError: unknown;
  try {
    await agent?.close();
  } catch (error) {
    firstError = error;
  }
  try {
    await supervisor.close();
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}
