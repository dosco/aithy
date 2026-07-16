import type { QueueServiceClient } from "../queue/client";

export type DirtyIndexInput = {
  memories?: string[];
  episodes?: string[];
  skills?: string[];
  knowledge?: string[];
};

export function createTargetedIndexQueue(
  queue: QueueServiceClient,
  role: "agent-worker" | "web",
): (input: DirtyIndexInput) => void {
  return (input) => {
    void queue.submitCommand("local-inference-worker", "embedding.indexTargets", input)
      .catch((error) => {
        if (role === "web") return;
        void queue.appendLog({
          role,
          level: "warn",
          source: "retrieval",
          message: `targeted embedding queue failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  };
}
