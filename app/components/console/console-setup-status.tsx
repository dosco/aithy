import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function SetupStatusList({ statuses }: { statuses: RuntimeSetupStatusDto[] }) {
  if (statuses.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2">
      {statuses.map((status) => (
        <SetupStatusRow key={status.key} status={status} />
      ))}
    </div>
  );
}

function SetupStatusRow({ status }: { status: RuntimeSetupStatusDto }) {
  const progress = typeof status.progress === "number" ? Math.round(status.progress * 100) : null;
  return (
    <div className="grid gap-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.44)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <LoaderCircle className={cn("h-3.5 w-3.5 shrink-0", iconTone(status), status.active && "animate-spin")} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{status.label}</span>
        {progress !== null ? (
          <span className="font-mono text-[11px] text-[rgb(var(--muted-foreground))]">{progress}%</span>
        ) : null}
      </div>
      {progress !== null ? (
        <div className="h-1 overflow-hidden rounded-full bg-[rgb(var(--border))]">
          <div
            className={cn("h-full rounded-full", barTone(status))}
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
      {status.loadedBytes || status.totalBytes ? (
        <div className="font-mono text-[10px] text-[rgb(var(--muted-foreground))]">
          {formatBytes(status.loadedBytes)} / {formatBytes(status.totalBytes)}
        </div>
      ) : null}
    </div>
  );
}

function iconTone(status: RuntimeSetupStatusDto): string {
  if (status.tone === "danger") return "text-[rgb(var(--danger))]";
  if (status.tone === "success") return "text-[rgb(var(--accent))]";
  return "text-sky-500 dark:text-sky-300";
}

function barTone(status: RuntimeSetupStatusDto): string {
  if (status.tone === "danger") return "bg-[rgb(var(--danger))]";
  if (status.tone === "success") return "bg-[rgb(var(--accent))]";
  return "bg-sky-500 dark:bg-sky-300";
}

function formatBytes(value: number | undefined): string {
  if (!value) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
