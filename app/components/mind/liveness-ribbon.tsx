import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { listMemoryRuns } from "@/server/actions.functions";
import type { MemoryRunDto } from "@/server/dto";
import { cn } from "@/lib/utils";
import { memoryRunSummaryForDisplay } from "./memory-run-display";

type Status = "running" | "idle" | "failed";

function deriveStatus(runs: MemoryRunDto[]): Status {
  if (runs.some((r) => r.status === "running")) return "running";
  const recent = runs[0];
  if (recent && recent.status === "failed") return "failed";
  return "idle";
}

const STATUS_DOT: Record<Status, string> = {
  running: "bg-sky-500 mind-dot-pulse",
  idle: "bg-emerald-500/70 mind-breath",
  failed: "bg-amber-500 mind-dot-pulse",
};

const STATUS_LABEL: Record<Status, string> = {
  running: "thinking",
  idle: "ready",
  failed: "stumbled",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function LivenessRibbon({ initialRuns }: { initialRuns: MemoryRunDto[] }) {
  const [runs, setRuns] = useState<MemoryRunDto[]>(initialRuns);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const fresh = await listMemoryRuns();
        if (!cancelled) setRuns(fresh);
      } catch {
        /* swallow */
      }
    };
    const id = setInterval(tick, 4_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const status = deriveStatus(runs);
  const recent = runs[0];
  const summary = memoryRunSummaryForDisplay(recent, status);

  return (
    <div className="mb-4 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/45 px-3 py-2">
      <div className="flex items-start gap-2 text-xs text-[rgb(var(--muted-foreground))]">
        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--foreground))]/70">
              {STATUS_LABEL[status]}
            </span>
            <span aria-hidden className="opacity-50">·</span>
            {recent ? (
              <span className="min-w-0 max-w-3xl">
                last {relativeTime(recent.startedAt)}
                {summary ? <>: <span className="italic">&ldquo;{summary}&rdquo;</span></> : null}
              </span>
            ) : (
              <span>no triage runs yet.</span>
            )}
            {runs.length > 1 ? (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="rounded-full px-2 text-xs font-medium text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--muted))]/60 hover:text-[rgb(var(--foreground))]"
              >
                {open ? "Hide history" : `${runs.length} runs`}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {open ? <RunHistory runs={runs} /> : null}
    </div>
  );
}

const RUN_DOT: Record<MemoryRunDto["status"], string> = {
  running: "bg-sky-500",
  completed: "bg-emerald-500/70",
  failed: "bg-red-500",
};

function RunHistory({ runs }: { runs: MemoryRunDto[] }) {
  return (
    <ul className="mt-3 grid max-w-3xl gap-1.5 border-l border-[rgb(var(--border))] pl-3">
      {runs.slice(0, 12).map((run) => {
        const summary =
          run.summary ?? run.error ?? (run.status === "running" ? "running…" : "—");
        const inner = (
          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-[12px] leading-5 text-[rgb(var(--muted-foreground))]">
            <span className={cn("mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full", RUN_DOT[run.status])} />
            <span className="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-wider opacity-70">
              {relativeTime(run.startedAt)}
            </span>
            <span className="min-w-0 whitespace-normal break-words" title={run.error ?? undefined}>
              {summary}
            </span>
          </div>
        );
        return (
          <li key={run.id}>
            {run.childSessionId ? (
              <Link
                to="/chat/$sessionId"
                params={{ sessionId: run.childSessionId }}
                className="block transition hover:opacity-80"
              >
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
