import type { MemoryRunDto } from "@/server/dto";

export type MemoryLivenessStatus = "running" | "idle" | "failed";

export function memoryRunSummaryForDisplay(
  run: MemoryRunDto | undefined,
  status: MemoryLivenessStatus,
): string | null {
  if (!run) return status === "running" ? "running..." : null;
  const summary = run.summary ?? run.error ?? (run.status === "running" ? "running..." : null);
  if (!summary) return null;
  if (run.status === "completed" && isQuietMemoryRunSummary(summary)) return null;
  return summary;
}

export function isQuietMemoryRunSummary(summary: string): boolean {
  const normalized = summary.trim().toLowerCase();
  return normalized === "nothing to remember"
    || normalized === "nothing to consolidate"
    || normalized === "store too small to consolidate"
    || normalized.startsWith("no-op:")
    || normalized.startsWith("[no-op]");
}
