import type { UsageBucketDto } from "@/server/dto";
import { providerDisplayName } from "../../src/agent/ai-providers";
import { LOCAL_CHAT_MODEL_ALIAS } from "../../src/local-inference/manifest";

export const PURPOSE_TINT: Record<string, string> = {
  chat: "fill-sky-500",
  "memory.triage": "fill-violet-500",
  "memory.consolidate": "fill-emerald-500",
  "memory.dream": "fill-fuchsia-500",
  "skill.promote": "fill-amber-500",
  other: "fill-zinc-500",
};

export const PURPOSE_LABEL: Record<string, string> = {
  chat: "chat",
  "memory.triage": "memory triage",
  "memory.consolidate": "memory consolidate",
  "memory.dream": "memory dream",
  "skill.promote": "skill promote",
  other: "other",
};

export const TOKEN_SEGMENTS = [
  { key: "input", label: "input", className: "bg-sky-500" },
  { key: "output", label: "output", className: "bg-amber-500" },
  { key: "thought", label: "thinking", className: "bg-violet-500" },
] as const;

export interface RangeTokenTotals {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export interface DayStack {
  bucket: string;
  byPurpose: Record<string, number>;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  total: number;
}

export interface ModelRow {
  provider: string;
  model: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  calls: number;
}

export function summarizeTokenTotals(rows: UsageBucketDto[]): RangeTokenTotals {
  const totals: RangeTokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
  };
  for (const row of rows) {
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.thoughtTokens += row.thoughtTokens;
    totals.cacheCreationTokens += row.cacheCreationTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.totalTokens += row.totalTokens;
  }
  return totals;
}

export function tokenValueFor(
  key: "input" | "output" | "thought",
  totals: RangeTokenTotals,
): number {
  if (key === "input") return totals.inputTokens;
  if (key === "output") return totals.outputTokens;
  return totals.thoughtTokens;
}

export function groupByDay(rows: UsageBucketDto[], days: number): DayStack[] {
  const map = new Map<string, DayStack>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    map.set(d, {
      bucket: d,
      byPurpose: {},
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      total: 0,
    });
  }
  for (const r of rows) {
    const day = map.get(r.bucket);
    if (!day) continue;
    day.byPurpose[r.purpose] = (day.byPurpose[r.purpose] ?? 0) + r.totalTokens;
    day.cacheCreationTokens += r.cacheCreationTokens;
    day.cacheReadTokens += r.cacheReadTokens;
    day.total += r.totalTokens;
  }
  return [...map.values()];
}

export function groupByModel(rows: UsageBucketDto[]): ModelRow[] {
  const map = new Map<string, ModelRow>();
  for (const r of rows) {
    const key = `${r.provider}/${r.model}`;
    const existing = map.get(key);
    if (existing) {
      existing.inputTokens += r.inputTokens;
      existing.cacheCreationTokens += r.cacheCreationTokens;
      existing.cacheReadTokens += r.cacheReadTokens;
      existing.totalTokens += r.totalTokens;
      existing.calls += r.calls;
    } else {
      map.set(key, {
        provider: r.provider,
        model: r.model,
        inputTokens: r.inputTokens,
        cacheCreationTokens: r.cacheCreationTokens,
        cacheReadTokens: r.cacheReadTokens,
        totalTokens: r.totalTokens,
        calls: r.calls,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

export function usageProviderLabel(provider: string, model: string): string {
  if (isLegacyLocalUsage(provider, model)) return "Local";
  const normalized = provider.trim().toLowerCase();
  return providerDisplayName(normalized || provider);
}

function isLegacyLocalUsage(provider: string, model: string): boolean {
  if (provider.trim().toLowerCase() !== "openai") return false;
  return model === LOCAL_CHAT_MODEL_ALIAS || model === "Qwen3.5-4B" || model.toLowerCase().endsWith(".gguf");
}
