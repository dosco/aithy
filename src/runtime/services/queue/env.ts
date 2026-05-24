import type { RuntimeServicePlacement, RuntimeServiceRole } from "../../protocol/types";
import { configureRuntimeTopology } from "../../topology";
import { QueueServiceClient } from "./client";

export async function connectQueueFromEnv(role: RuntimeServiceRole): Promise<QueueServiceClient> {
  configureTopologyFromEnv();
  const url = process.env.AITHY_QUEUE_URL;
  if (!url) throw new Error("Missing AITHY_QUEUE_URL");
  return QueueServiceClient.connect({ url, role, placement: placementFromEnv() });
}

function configureTopologyFromEnv(): void {
  if (process.env.AITHY_RUNTIME_KIND === "packaged") {
    configureRuntimeTopology({ kind: "packaged" });
  }
}

function placementFromEnv(): RuntimeServicePlacement | undefined {
  return process.env.AITHY_SERVICE_PLACEMENT === "process"
    || process.env.AITHY_SERVICE_PLACEMENT === "coordinator"
    ? process.env.AITHY_SERVICE_PLACEMENT
    : undefined;
}
