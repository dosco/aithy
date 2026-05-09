import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { listMemoryRuns } from "@/server/actions.functions";
import type { MemoryRunDto } from "@/server/dto";
import { cn } from "@/lib/utils";

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
  idle: "settled",
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
  const summary =
    recent?.summary ?? recent?.error ?? (status === "running" ? "running…" : null);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[rgb(var(--muted-foreground))]">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[status])} />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--foreground))]/70">
          {STATUS_LABEL[status]}
        </span>
        {recent ? (
          <>
            <span aria-hidden className="opacity-50">·</span>
            <span className="truncate">
              last {relativeTime(recent.startedAt)}
              {summary ? <>: <span className="italic">&ldquo;{summary}&rdquo;</span></> : null}
            </span>
          </>
        ) : (
          <>
            <span aria-hidden className="opacity-50">·</span>
            <span>no triage runs yet.</span>
          </>
        )}
        {runs.length > 1 ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded-full font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]"
          >
            {open ? "hide history" : `${runs.length} runs ↓`}
          </button>
        ) : null}
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
    <ul className="mt-3 grid gap-1 border-l border-[rgb(var(--border))] pl-3">
      {runs.slice(0, 12).map((run) => {
        const summary =
          run.summary ?? run.error ?? (run.status === "running" ? "running…" : "—");
        const inner = (
          <div className="flex items-baseline gap-2 text-[12px] text-[rgb(var(--muted-foreground))]">
            <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full self-center", RUN_DOT[run.status])} />
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-70 shrink-0">
              {relativeTime(run.startedAt)}
            </span>
            <span className="min-w-0 flex-1 truncate" title={run.error ?? undefined}>
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
