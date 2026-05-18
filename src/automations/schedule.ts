import type { AutomationSchedule } from "./types";

export const DEFAULT_AUTOMATION_TIME = "08:00";

export interface ScheduleDraft {
  scheduleKind: string;
  time?: string;
  dayOfWeek?: string;
  everyMinutes?: number;
  cronPattern?: string;
  runAt?: string;
  human?: string;
}

export function automationSchedulerId(id: string): string {
  return `automation:${id}`;
}

export function buildAutomationSchedule(input: ScheduleDraft): AutomationSchedule {
  const kind = input.scheduleKind.trim().toLowerCase();
  if (kind === "interval" || kind === "interval_minutes") {
    const minutes = clampWhole(input.everyMinutes ?? 60, 1, 60 * 24 * 30);
    return {
      kind: "interval",
      everyMs: minutes * 60_000,
      human: input.human?.trim() || `Every ${minutes} minute${minutes === 1 ? "" : "s"}`,
    };
  }
  if (kind === "hourly") {
    return { kind: "interval", everyMs: 60 * 60_000, human: input.human?.trim() || "Every hour" };
  }
  if (kind === "cron") {
    const pattern = input.cronPattern?.trim();
    if (!pattern) throw new Error("cron schedule requires cronPattern");
    return { kind: "cron", pattern, human: input.human?.trim() || `Cron ${pattern}` };
  }
  if (kind === "once") {
    const runAt = parseRunAt(input.runAt);
    return {
      kind: "once",
      runAt: runAt.toISOString(),
      human: input.human?.trim() || `Once at ${runAt.toLocaleString()}`,
    };
  }

  const [hour, minute] = parseTime(input.time ?? DEFAULT_AUTOMATION_TIME);
  if (kind === "weekdays") {
    return {
      kind: "cron",
      pattern: `${minute} ${hour} * * 1-5`,
      human: input.human?.trim() || `Weekdays at ${formatTime(hour, minute)}`,
    };
  }
  if (kind === "weekly") {
    const day = clampWhole(Number(input.dayOfWeek ?? 1), 0, 6);
    return {
      kind: "cron",
      pattern: `${minute} ${hour} * * ${day}`,
      human: input.human?.trim() || `Weekly on ${dayName(day)} at ${formatTime(hour, minute)}`,
    };
  }
  return {
    kind: "cron",
    pattern: `${minute} ${hour} * * *`,
    human: input.human?.trim() || `Daily at ${formatTime(hour, minute)}`,
  };
}

export function parseSchedule(raw: string): AutomationSchedule {
  const value = JSON.parse(raw) as AutomationSchedule;
  if (value.kind === "cron" && typeof value.pattern === "string") {
    return { kind: "cron", pattern: value.pattern, human: value.human || value.pattern, skipMissed: value.skipMissed };
  }
  if (value.kind === "interval" && typeof value.everyMs === "number") {
    return { kind: "interval", everyMs: value.everyMs, human: value.human || "Interval", skipMissed: value.skipMissed };
  }
  if (value.kind === "once" && typeof value.runAt === "string") {
    return { kind: "once", runAt: new Date(value.runAt).toISOString(), human: value.human || "Once" };
  }
  throw new Error("Invalid automation schedule");
}

function parseRunAt(input: string | undefined): Date {
  if (!input?.trim()) throw new Error("once schedule requires runAt");
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error("once schedule runAt is invalid");
  return date;
}

function parseTime(input: string): [number, number] {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) return [8, 0];
  const hour = clampWhole(Number(match[1]), 0, 23);
  const minute = clampWhole(Number(match[2]), 0, 59);
  return [hour, minute];
}

function clampWhole(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function dayName(day: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] ?? "Monday";
}
