import type { MemoryTimingInput } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayLocalDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function assertIsoDate(value: string | null | undefined, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isIsoDate(value)) throw new Error(`${field} must be an ISO date string (YYYY-MM-DD).`);
  return value;
}

export function isExpired(validUntil: string | null | undefined, nowDate = todayLocalDate()): boolean {
  return Boolean(validUntil && validUntil < nowDate);
}

export function normalizeMemoryTiming(input: MemoryTimingInput): Required<MemoryTimingInput> {
  const validFrom = assertIsoDate(input.validFrom, "validFrom") ?? null;
  const validUntil = assertIsoDate(input.validUntil, "validUntil") ?? null;
  return {
    validFrom,
    validUntil,
    durationDays: validFrom && validUntil ? durationDays(validFrom, validUntil) : normalizeDuration(input.durationDays),
    evidence: cleanOptionalText(input.evidence),
    frequency: cleanOptionalText(input.frequency),
  };
}

function durationDays(validFrom: string, validUntil: string): number {
  const start = Date.parse(`${validFrom}T00:00:00Z`);
  const end = Date.parse(`${validUntil}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function cleanOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDuration(value: number | null | undefined): number | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}
