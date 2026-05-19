import * as Popover from "@radix-ui/react-popover";
import { Link } from "@tanstack/react-router";
import { ChevronRight, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useRuntimeConsole } from "./use-runtime-console";

export function ConsoleButton() {
  const state = useRuntimeConsole();
  const [open, setOpen] = useState(false);
  const queue = state.queues.find((item) => item.id === "agent.chat");
  const hasIssue = state.services.some((service) => service.state === "failed" || service.state === "degraded")
    || queue?.state === "blocked";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Runtime console"
          className={cn("app-top-icon relative", open && "app-top-icon-active")}
        >
          <SquareTerminal className="h-4 w-4" />
          {hasIssue ? (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="z-40 flex max-h-96 w-[24rem] flex-col overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-2 shadow-[0_12px_34px_rgb(0_0_0/0.12)] outline-none"
        >
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Console</div>
              <div className="truncate text-[11px] text-[rgb(var(--muted-foreground))]">
                {queue?.blockedReason ?? queue?.state ?? "runtime status"}
              </div>
            </div>
            <Link
              to="/console"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
              title="Open console"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="flex flex-wrap gap-1.5 px-2 pb-2">
            {state.services.map((service) => (
              <span
                key={service.role}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-[10px]",
                  service.state === "ready"
                    ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                    : service.state === "failed"
                      ? "border-red-500/40 text-red-700 dark:text-red-300"
                      : "border-amber-500/40 text-amber-700 dark:text-amber-300",
                )}
              >
                {service.role}: {service.state}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {state.logs.length === 0 ? (
              <div className="px-4 py-7 text-center text-sm text-[rgb(var(--muted-foreground))]">
                No logs yet.
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {state.logs.slice(0, 8).map((log) => (
                  <li key={`${log.id}-${log.createdAt}`} className="rounded-md px-3 py-2 hover:bg-[rgb(var(--muted))]/55">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase text-[rgb(var(--muted-foreground))]">
                        {log.role} · {log.level}
                      </span>
                      <span className="text-[10px] text-[rgb(var(--muted-foreground))]">{relativeTime(log.createdAt)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5">{log.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
