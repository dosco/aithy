import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SetupProgressSplash } from "@/components/setup-progress-splash";
import type { RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function SandboxImageSplashOverlay({
  status,
}: {
  status: RuntimeSetupStatusDto | null;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!status) return null;
  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-[rgb(var(--background))]">
      <SetupProgressSplash
        eyebrow="Sandbox image"
        title="Preparing the document sandbox."
        description="Aithy is downloading and assembling the sandbox image before the first tool run."
        fallbackLabel="Waiting for sandbox image"
        statuses={[status]}
      />
    </div>,
    document.body,
  );
}
