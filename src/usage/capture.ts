import type { SqliteUsageStore } from "./usage-store";
import type { UsagePurpose } from "./types";

/**
 * ax exposes per-(provider, model) aggregated usage through `program.getUsage()`
 * after a forward(). We don't need to hook each LLM call — one row per
 * (provider, model) per agent run is the right granularity for the usage page.
 */
interface ProgramUsageEntry {
  ai?: string;
  model?: string;
  tokens?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    thoughtsTokens?: number;
  };
}

interface ProgramUsageLike {
  getUsage?: () => unknown;
  resetUsage?: () => void;
}

export interface CaptureOpts {
  store: SqliteUsageStore;
  purpose: UsagePurpose;
  sessionId?: string | null;
  runId?: string | null;
}

export function captureProgramUsage(program: unknown, opts: CaptureOpts): void {
  const p = program as ProgramUsageLike;
  if (typeof p.getUsage !== "function") return;
  let rawUsage: unknown;
  try {
    rawUsage = p.getUsage();
  } catch {
    return;
  }
  const entries = normalizeUsage(rawUsage);
  for (const entry of entries) {
    const tokens = entry.tokens;
    if (!tokens) continue;
    const input = tokens.promptTokens ?? 0;
    const output = tokens.completionTokens ?? 0;
    const thought = tokens.thoughtsTokens ?? 0;
    const total = tokens.totalTokens ?? input + output + thought;
    if (total <= 0) continue;
    opts.store.record({
      provider: entry.ai ?? "unknown",
      model: entry.model ?? "unknown",
      purpose: opts.purpose,
      inputTokens: input,
      outputTokens: output,
      thoughtTokens: thought,
      totalTokens: total,
      sessionId: opts.sessionId ?? null,
      runId: opts.runId ?? null,
    });
  }
  // Don't reset — ax accumulates across the agent's life; we only persist
  // deltas would require tracking previous totals. Recording cumulative would be
  // wrong for time-series, so we explicitly reset after capture.
  try {
    p.resetUsage?.();
  } catch {
    // ignore
  }
}

function normalizeUsage(rawUsage: unknown): ProgramUsageEntry[] {
  if (Array.isArray(rawUsage)) return rawUsage.filter(isUsageEntry);
  if (!rawUsage || typeof rawUsage !== "object") return [];

  const split = rawUsage as {
    actor?: unknown;
    responder?: unknown;
  };
  return [...usageEntries(split.actor), ...usageEntries(split.responder)];
}

function usageEntries(value: unknown): ProgramUsageEntry[] {
  return Array.isArray(value) ? value.filter(isUsageEntry) : [];
}

function isUsageEntry(value: unknown): value is ProgramUsageEntry {
  return Boolean(value) && typeof value === "object";
}
