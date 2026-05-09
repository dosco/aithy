import type { AppConfig } from "../config/env";
import type { RuntimeSettings } from "./types";

export function applyRuntimeSettings(
  config: AppConfig,
  settings: RuntimeSettings,
  apiKey?: string,
  fastApiKey?: string,
): AppConfig {
  const fastProvider = cleanString(settings.fastAiProvider);
  return {
    ...config,
    aiProvider: cleanString(settings.aiProvider) ?? config.aiProvider,
    aiApiKey: config.aiApiKey ?? apiKey,
    aiModel: cleanString(settings.aiModel) ?? config.aiModel,
    fastAiProvider: fastProvider,
    fastAiModel: fastProvider ? cleanString(settings.fastAiModel) : undefined,
    fastAiApiKey: fastProvider ? fastApiKey : undefined,
    sandboxProvider: normalizeSandboxProvider(settings.sandboxProvider) ?? config.sandboxProvider,
    sandboxImage: cleanString(settings.sandboxImage) ?? config.sandboxImage,
    sandboxCpus: settings.sandboxCpus ?? config.sandboxCpus,
    sandboxMemoryMb: settings.sandboxMemoryMb ?? config.sandboxMemoryMb,
    sandboxNetwork: settings.sandboxNetwork ?? config.sandboxNetwork,
    sessionTtlMs: settings.sessionTtlMs ?? config.sessionTtlMs,
    traceEnabled: settings.traceEnabled ?? config.traceEnabled,
    globalMounts: settings.globalMounts ?? config.globalMounts ?? [],
  };
}

export function runtimeSandboxChanged(a: AppConfig, b: AppConfig): boolean {
  return a.sandboxProvider !== b.sandboxProvider
    || a.sandboxImage !== b.sandboxImage
    || a.sandboxCpus !== b.sandboxCpus
    || a.sandboxMemoryMb !== b.sandboxMemoryMb
    || a.sandboxNetwork !== b.sandboxNetwork;
}

export function globalMountsChanged(a: AppConfig, b: AppConfig): boolean {
  const aMounts = a.globalMounts ?? [];
  const bMounts = b.globalMounts ?? [];
  if (aMounts.length !== bMounts.length) return true;
  const aSet = new Set(aMounts.map((m) => m.hostPath));
  for (const m of bMounts) {
    if (!aSet.has(m.hostPath)) return true;
  }
  return false;
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSandboxProvider(value: unknown): AppConfig["sandboxProvider"] | undefined {
  if (value === "microsandbox") return "microsandbox";
  if (value === "disabled" || value === "mock") return "disabled";
  return undefined;
}
