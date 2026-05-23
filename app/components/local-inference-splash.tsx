import { SetupProgressSplash } from "@/components/setup-progress-splash";
import type { RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function LocalInferenceSplash({
  statuses,
}: {
  statuses: RuntimeSetupStatusDto[];
}) {
  return (
    <SetupProgressSplash
      eyebrow="Local inference"
      title="Preparing the local model runtime."
      description="Aithy is starting the local router and getting the chat, embedding, and reranking models ready."
      fallbackLabel="Waiting for local inference"
      statuses={statuses}
    />
  );
}
