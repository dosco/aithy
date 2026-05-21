import type { SqliteUsageStore } from "./usage-store";
import type { UsagePurpose } from "./types";
import type { AppConfig } from "../config/env";
import { isCustomOpenAIProvider, isLocalAiProvider } from "../agent/ai-providers";

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
    reasoningTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
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
  attribution?: readonly UsageAttribution[];
}

export interface UsageAttribution {
  backendProvider: string;
  provider: string;
  model?: string;
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
    const thought = tokens.thoughtsTokens ?? tokens.reasoningTokens ?? 0;
    const cacheCreation = tokens.cacheCreationTokens ?? 0;
    const cacheRead = tokens.cacheReadTokens ?? 0;
    const total = tokens.totalTokens ?? input + output + thought;
    if (total <= 0) continue;
    const attribution = usageAttributionForEntry(entry, opts.attribution);
    opts.store.record({
      provider: attribution?.provider ?? normalizedProvider(entry.ai) ?? "unknown",
      model: entry.model ?? "unknown",
      purpose: opts.purpose,
      inputTokens: input,
      outputTokens: output,
      thoughtTokens: thought,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
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

export function usageAttributionForConfig(config: AppConfig): UsageAttribution[] {
  const entries: UsageAttribution[] = [
    {
      backendProvider: backendProviderForUsage(config.aiProvider),
      provider: config.aiProvider,
      model: config.aiModel,
    },
  ];
  if (config.fastAiProvider) {
    entries.push({
      backendProvider: backendProviderForUsage(config.fastAiProvider),
      provider: config.fastAiProvider,
      model: config.fastAiModel,
    });
  }
  return entries;
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

function usageAttributionForEntry(
  entry: ProgramUsageEntry,
  attributions: readonly UsageAttribution[] | undefined,
): UsageAttribution | undefined {
  if (!attributions?.length) return undefined;
  const entryProvider = normalizedProvider(entry.ai);
  const entryModel = entry.model;
  return attributions.find((candidate) => {
    if (normalizedProvider(candidate.backendProvider) !== entryProvider) return false;
    return candidate.model && entryModel ? candidate.model === entryModel : true;
  });
}

function backendProviderForUsage(provider: string): string {
  return isCustomOpenAIProvider(provider) || isLocalAiProvider(provider) ? "openai" : provider;
}

function normalizedProvider(provider: string | undefined): string | undefined {
  return provider?.trim().toLowerCase() || undefined;
}
