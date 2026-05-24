import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RuntimeServiceDto } from "@/server/runtime-console.dto";

export function ServiceStatus({ service }: { service: RuntimeServiceDto }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.44)] px-3 py-2">
      <Circle className={cn("h-2.5 w-2.5 fill-current", dotTone(toneForState(service.state)))} />
      <div className="min-w-0">
        <div className="truncate font-mono text-xs">{service.role}</div>
        <div className="truncate text-[11px] text-[rgb(var(--muted-foreground))]">
          {serviceStatusSummary(service) || formatTimestamp(service.lastSeenAt)}
        </div>
      </div>
      <StatePill label={service.state} tone={toneForState(service.state)} />
    </div>
  );
}

export function StatePill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn("w-fit rounded border px-2 py-0.5 font-mono text-[11px] uppercase", pillTone(tone))}>
      {label}
    </span>
  );
}

export function serviceIssueSummary(service: RuntimeServiceDto): string | null {
  if (service.state !== "failed" && service.state !== "degraded") return null;
  return `${service.role}: ${serviceStatusSummary(service) || service.state}`;
}

export function serviceStatusSummary(service: RuntimeServiceDto): string {
  if (service.role === "local-inference-worker") {
    const local = localInferenceSummary(service.detail);
    if (local) return local;
  }
  return detailText(service.detail);
}

export function detailText(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export type Tone = "neutral" | "ok" | "busy" | "warn" | "bad";

export function toneForState(state: string): Tone {
  if (state === "ready" || state === "completed" || state === "idle") return "ok";
  if (state === "busy" || state === "running" || state === "claimed") return "busy";
  if (state === "starting" || state === "pending" || state === "paused" || state === "stopping") return "warn";
  if (state === "failed" || state === "degraded" || state === "blocked") return "bad";
  return "neutral";
}

function localInferenceSummary(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const record = detail as Record<string, unknown>;
  const error = stringValue(record.error);
  const restartInMs = numberValue(record.restartInMs);
  if (error && restartInMs !== undefined) return `${error}; retrying in ${formatDelay(restartInMs)}`;
  if (error) return error;
  const baseUrl = stringValue(record.baseUrl);
  if (record.ready === true && baseUrl) return `ready at ${baseUrl}`;
  if (record.routerRequired === true) return "local inference router required";
  return "";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatDelay(ms: number): string {
  if (ms >= 1_000) return `${Math.ceil(ms / 1_000)}s`;
  return `${ms}ms`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pillTone(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "border-[rgb(var(--accent)/0.42)] bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent))]";
    case "busy":
      return "border-sky-500/35 bg-sky-500/10 text-sky-500 dark:text-sky-300";
    case "warn":
      return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "bad":
      return "border-[rgb(var(--danger)/0.42)] bg-[rgb(var(--danger)/0.12)] text-[rgb(var(--danger))]";
    default:
      return "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]";
  }
}

function dotTone(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "text-[rgb(var(--accent))]";
    case "busy":
      return "text-sky-500 dark:text-sky-300";
    case "warn":
      return "text-amber-600 dark:text-amber-300";
    case "bad":
      return "text-[rgb(var(--danger))]";
    default:
      return "text-[rgb(var(--muted-foreground))]";
  }
}
