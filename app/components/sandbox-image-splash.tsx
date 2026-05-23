import { SetupProgressSplash } from "@/components/setup-progress-splash";
import type { RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function SandboxImageSplashOverlay({
  status,
}: {
  status: RuntimeSetupStatusDto | null;
}) {
  if (!status) return null;

  return (
    <div className="fixed inset-0 z-20 bg-[rgb(var(--background))]">
      <SetupProgressSplash
        eyebrow="Sandbox image"
        title="Preparing the document sandbox."
        description="Aithy is downloading and assembling the sandbox image before the first tool run."
        fallbackLabel="Waiting for sandbox image"
        statuses={[status]}
      />
    </div>
  );
}
