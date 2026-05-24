import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SetupProgressSplash } from "@/components/setup-progress-splash";
import { retrySandboxSetup } from "@/server/console.functions";
import type { RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function SandboxImageSplashOverlay({
  status,
}: {
  status: RuntimeSetupStatusDto | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!status) return null;
  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-[rgb(var(--background))]">
      <SetupProgressSplash
        eyebrow="Sandbox image"
        title="Preparing the secure sandbox."
        description="Downloading and assembling the secure sandbox image."
        fallbackLabel="Waiting for sandbox image"
        statuses={[status]}
        dangerActionLabel="Retry sandbox"
        dangerActionBusy={retryBusy}
        onDangerAction={() => {
          setRetryBusy(true);
          void retrySandboxSetup()
            .catch(() => undefined)
            .finally(() => setRetryBusy(false));
        }}
      />
    </div>,
    document.body,
  );
}
