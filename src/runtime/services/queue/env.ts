import type { RuntimeServiceRole } from "../../protocol/types";
import { QueueServiceClient } from "./client";

export async function connectQueueFromEnv(role: RuntimeServiceRole): Promise<QueueServiceClient> {
  const url = process.env.AITHY_QUEUE_URL;
  if (!url) throw new Error("Missing AITHY_QUEUE_URL");
  return QueueServiceClient.connect({ url, role });
}
