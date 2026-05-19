import type { DreamQueue } from "../../../episodes/dream-queue";
import type { MemoryExpiryQueue } from "../../../memory/expiry-queue";

export async function scheduleAgentBackgroundQueues(input: {
  memoryExpiry: Pick<MemoryExpiryQueue, "schedule">;
  dreamQueue: Pick<DreamQueue, "schedule">;
}): Promise<void> {
  // arXiv:2605.12978 argues repeated LLM consolidation can degrade memory;
  // keep dreams automatic, but leave consolidation as a manual action.
  await Promise.all([input.memoryExpiry.schedule(), input.dreamQueue.schedule()]);
}
