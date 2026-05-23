import { LEGACY_DEFAULT_SANDBOX_IMAGE, type AppConfig } from "../config/env";
import { MAX_PARALLEL_AGENTS } from "../config/limits";
import { isLocalAiProvider } from "../agent/ai-providers";
import { selectedLocalAgentModelId } from "../local-inference/manifest";
import { normalizeLocalInferenceSettings } from "../local-inference/settings";
import type { RuntimeSettings } from "./types";
import { activeSearchProvider, aiProfileFor, providerUsesApiUrl, searchProfileFor } from "./provider-profiles";

export function applyRuntimeSettings(
  config: AppConfig,
  settings: RuntimeSettings,
  apiKey?: string | null,
  fastApiKey?: string | null,
  parallelApiKey?: string | null,
): AppConfig {
  const fastProvider = cleanString(settings.fastAiProvider);
  const aiProvider = cleanString(settings.aiProvider) ?? config.aiProvider;
  const aiProfile = aiProfileFor(settings, aiProvider);
  const fastProfile = fastProvider ? aiProfileFor(settings, fastProvider) : {};
  const searchProvider = activeSearchProvider(settings);
  const searchProfile = searchProfileFor(settings, searchProvider);
  const localAgentModel = selectedLocalAgentModelId(
    settings.localAgentModel === null
      ? undefined
      : cleanString(settings.localAgentModel) ?? config.localAgentModel,
  );
  const aiModel = settings.aiModel === null
    ? undefined
    : cleanString(aiProfile.model ?? undefined) ?? cleanString(settings.aiModel) ?? config.aiModel;
  return {
    ...config,
    aiProvider,
    aiApiUrl: providerUsesApiUrl(aiProvider)
      ? (aiProfile.apiUrl ?? settings.aiApiUrl) === null
        ? undefined
        : cleanString(aiProfile.apiUrl ?? undefined) ?? cleanString(settings.aiApiUrl ?? undefined) ?? config.aiApiUrl
      : undefined,
    aiApiKey: apiKey === null ? undefined : config.aiApiKey ?? apiKey,
    aiModel: isLocalAiProvider(aiProvider) ? localAgentModel : aiModel,
    localAgentModel,
    localInference: normalizeLocalInferenceSettings({
      ...config.localInference,
      ...settings.localInference,
    }),
    fastAiProvider: fastProvider,
    fastAiApiUrl: fastProvider && providerUsesApiUrl(fastProvider)
      ? (fastProfile.fastApiUrl ?? fastProfile.apiUrl ?? settings.fastAiApiUrl) === null
        ? undefined
        : cleanString(fastProfile.fastApiUrl ?? undefined)
          ?? cleanString(fastProfile.apiUrl ?? undefined)
          ?? cleanString(settings.fastAiApiUrl ?? undefined)
          ?? config.fastAiApiUrl
      : undefined,
    fastAiModel: fastProvider
      ? isLocalAiProvider(fastProvider)
        ? localAgentModel
        : cleanString(fastProfile.fastModel ?? undefined) ?? cleanString(settings.fastAiModel)
      : undefined,
    fastAiApiKey: fastProvider ? (fastApiKey === null ? undefined : fastApiKey) : undefined,
    sandboxProvider: normalizeSandboxProvider(settings.sandboxProvider) ?? config.sandboxProvider,
    sandboxImage: normalizeSandboxImage(settings.sandboxImage) ?? config.sandboxImage,
    sandboxCpus: settings.sandboxCpus ?? config.sandboxCpus,
    sandboxMemoryMb: settings.sandboxMemoryMb ?? config.sandboxMemoryMb,
    sandboxNetwork: settings.sandboxNetwork ?? config.sandboxNetwork,
    sessionTtlMs: settings.sessionTtlMs ?? config.sessionTtlMs,
    parallelAgents: clampParallelAgents(settings.parallelAgents) ?? config.parallelAgents,
    searchProvider,
    parallelSearchMcpUrl: (searchProfile.url ?? settings.parallelSearchMcpUrl) === null
      ? config.parallelSearchMcpUrl
      : cleanString(searchProfile.url ?? undefined) ?? cleanString(settings.parallelSearchMcpUrl ?? undefined) ?? config.parallelSearchMcpUrl,
    parallelApiKey: parallelApiKey === null
      ? undefined
      : parallelApiKey ?? config.parallelApiKey,
    systemBashEnabled: settings.systemBashEnabled ?? config.systemBashEnabled,
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

function normalizeSandboxImage(value: string | undefined): string | undefined {
  const image = cleanString(value);
  return image && image !== LEGACY_DEFAULT_SANDBOX_IMAGE ? image : undefined;
}

function clampParallelAgents(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(MAX_PARALLEL_AGENTS, Math.floor(value)));
}
