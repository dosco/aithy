import { Box, Circle, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuntimeServiceDto, RuntimeSetupStatusDto } from "@/server/runtime-console.dto";

export function SandboxStatusPanel({
  service,
  status,
}: {
  service?: RuntimeServiceDto;
  status?: RuntimeSetupStatusDto;
}) {
  const detail = objectDetail(service?.detail);
  const image = stringValue(detail.image);
  const selection = stringValue(detail.selection);
  const label = stringValue(detail.label) || "Sandbox image";
  const provider = stringValue(detail.provider) || "unknown";
  const network = stringValue(detail.network) || "unknown";
  const cpus = numberValue(detail.cpus);
  const memoryMb = numberValue(detail.memoryMb);
  const state = service?.state ?? "unknown";

  return (
    <div className="mt-3 grid gap-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.54)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Circle className={cn("h-2.5 w-2.5 fill-current", state === "ready" ? "text-[rgb(var(--accent))]" : "text-amber-500")} />
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-[rgb(var(--muted-foreground))]">sandbox vm</span>
        <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 font-mono text-[11px] uppercase">{state}</span>
      </div>
      <div className="grid gap-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Box className="h-4 w-4 text-[rgb(var(--accent))]" />
          {label}
        </div>
        {selection ? (
          <div className="font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
            selected: <span className="text-[rgb(var(--foreground))]">{selection}</span>
          </div>
        ) : null}
        <div className="break-all font-mono text-xs leading-5 text-[rgb(var(--muted-foreground))]">
          {image || "No sandbox image reported yet"}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
        <span className="inline-flex items-center gap-1 rounded border border-[rgb(var(--border))] px-2 py-1">
          <Network className="h-3 w-3" /> {provider} / {network}
        </span>
        {cpus ? <span className="rounded border border-[rgb(var(--border))] px-2 py-1">{cpus} cpu</span> : null}
        {memoryMb ? <span className="rounded border border-[rgb(var(--border))] px-2 py-1">{memoryMb} MB</span> : null}
      </div>
      {status ? (
        <div className="rounded border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.52)] px-2 py-1.5 font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
          setup: <span className="break-words text-[rgb(var(--foreground))]">{status.label}</span>
        </div>
      ) : null}
    </div>
  );
}

function objectDetail(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
