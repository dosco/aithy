import { LoaderCircle } from "lucide-react";
import { AsciiSplash } from "@/components/ascii-splash";
import { cn } from "@/lib/utils";
import type { RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function LocalInferenceSplash({
  statuses,
}: {
  statuses: RuntimeSetupStatusDto[];
}) {
  const primary = statuses.find((status) => status.tone === "danger")
    ?? statuses.find((status) => status.active)
    ?? statuses[0];
  const progress = typeof primary?.progress === "number" ? Math.round(primary.progress * 100) : null;
  const statusLabel = primary?.label ?? "Waiting for local inference";
  const danger = primary?.tone === "danger";

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-20">
      <div className="max-w-xl">
        <div className="mb-8 text-[rgb(var(--muted-foreground))]" aria-hidden="true">
          <AsciiSplash compact />
        </div>

        <p className="font-mono text-xs uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
          Local inference
        </p>
        <h1 className="mt-3 max-w-2xl text-2xl font-semibold leading-[1.08] text-balance sm:text-4xl">
          Preparing the local model runtime.
        </h1>
        <p className="mt-4 max-w-lg text-sm leading-6 text-[rgb(var(--muted-foreground))]">
          Aithy is starting the local router and getting the chat, embedding, and reranking models ready.
        </p>

        <div className="mt-10" aria-live="polite">
          <div className="flex items-center justify-between gap-4 text-left">
            <div className="flex min-w-0 items-center gap-3">
              <LoaderCircle className={cn(
                "h-3.5 w-3.5 shrink-0",
                danger ? "text-[rgb(var(--danger))]" : "animate-spin text-[rgb(var(--accent))]",
              )} />
              <p className={cn(
                "min-w-0 truncate font-mono text-xs sm:text-sm",
                danger ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--foreground))]",
              )}>
                {statusLabel}
              </p>
            </div>
            {progress !== null ? (
              <span className="shrink-0 font-mono text-xs text-[rgb(var(--muted-foreground))]">
                {progress}%
              </span>
            ) : null}
          </div>

          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[rgb(var(--border)/0.7)]">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                danger ? "bg-[rgb(var(--danger))]" : "bg-[rgb(var(--accent))]",
                progress === null && "w-1/3 animate-pulse",
              )}
              style={progress !== null ? { width: `${progress}%` } : undefined}
            />
          </div>
          {primary?.loadedBytes || primary?.totalBytes ? (
            <p className="mt-2 text-left font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
              {formatBytes(primary.loadedBytes)} / {formatBytes(primary.totalBytes)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function formatBytes(value: number | undefined): string {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
