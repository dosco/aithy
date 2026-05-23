import type { RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function visibleSandboxImageStatus(
  statuses: RuntimeSetupStatusDto[],
): RuntimeSetupStatusDto | null {
  return statuses.find((status) => status.key === "sandbox" && isSandboxImageStatus(status)) ?? null;
}

export function isSandboxImageStatus(status: RuntimeSetupStatusDto): boolean {
  if (status.key !== "sandbox") return false;
  if (status.tone === "danger" && status.label.toLowerCase().startsWith("sandbox failed")) return true;
  if (!status.active) return false;

  const label = status.label.toLowerCase();
  if (label.includes("resolving sandbox image")) return true;
  if (label.includes("resolved sandbox image")) return true;
  if (label.includes("downloading sandbox image")) return true;
  if (label.includes("preparing sandbox filesystem")) return true;
  return label.includes("starting sandbox image") && hasProgress(status);
}

function hasProgress(status: RuntimeSetupStatusDto): boolean {
  return typeof status.progress === "number"
    || typeof status.loadedBytes === "number"
    || typeof status.totalBytes === "number";
}
