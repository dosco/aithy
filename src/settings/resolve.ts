import type { AppConfig } from "../config/env";
import { MAX_PARALLEL_AGENTS } from "../config/limits";
import {
  isLocalAiProvider,
  normalizeServiceTierForSelection,
  normalizeThinkingLevelForSelection,
  providerUsesApiUrl,
} from "../agent/ai-providers";
import { selectedLocalAgentModelId } from "../local-inference/manifest";
import { normalizeLocalInferenceSettings } from "../local-inference/settings";
import {
  defaultSandboxImageResolutionContext,
  resolveSandboxImageConfig,
  type SandboxImageResolutionContext,
} from "../sandbox/image-catalog";
import type { RuntimeSettings } from "./types";
import { activeSearchProvider, aiProfileFor, searchProfileFor } from "./provider-profiles";

export function applyRuntimeSettings(
  config: AppConfig,
  settings: RuntimeSettings,
  apiKey?: string | null,
  fastApiKey?: string | null,
  parallelApiKey?: string | null,
  sandboxImageContext: SandboxImageResolutionContext = defaultSandboxImageResolutionContext(),
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
  const fastAiModel = fastProvider
    ? isLocalAiProvider(fastProvider)
      ? localAgentModel
      : cleanString(fastProfile.fastModel ?? undefined) ?? cleanString(settings.fastAiModel)
    : undefined;
  const sandboxImage = resolveSandboxImageConfig(settings, sandboxImageContext);
  const trainingDataCaptureEnabled =
    settings.trainingDataCaptureEnabled
    ?? settings.traceEnabled
    ?? config.trainingDataCaptureEnabled
    ?? config.traceEnabled;
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
    aiProfileArgs: aiProfile.profileArgs ?? settings.aiProfileArgs,
    aiThinkingLevel: normalizeThinkingLevelForSelection(
      aiProvider,
      aiModel,
      aiProfile.thinkingLevel ?? settings.aiThinkingLevel,
    ),
    aiServiceTier: normalizeServiceTierForSelection(
      aiProvider,
      aiModel,
      aiProfile.serviceTier ?? settings.aiServiceTier,
    ),
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
    fastAiModel,
    fastAiProfileArgs: fastProvider
      ? fastProfile.fastProfileArgs ?? fastProfile.profileArgs ?? settings.fastAiProfileArgs
      : undefined,
    fastAiThinkingLevel: fastProvider
      ? normalizeThinkingLevelForSelection(
        fastProvider,
        fastAiModel,
        fastProfile.fastThinkingLevel ?? settings.fastAiThinkingLevel,
      )
      : undefined,
    fastAiServiceTier: fastProvider
      ? normalizeServiceTierForSelection(
        fastProvider,
        fastAiModel,
        fastProfile.fastServiceTier ?? settings.fastAiServiceTier,
      )
      : undefined,
    fastAiApiKey: fastProvider ? (fastApiKey === null ? undefined : fastApiKey) : undefined,
    sandboxProvider: normalizeSandboxProvider(settings.sandboxProvider) ?? config.sandboxProvider,
    sandboxImage: sandboxImage.image,
    sandboxImageLabel: sandboxImage.label,
    sandboxImageSelection: sandboxImage.selection,
    customSandboxImages: sandboxImage.customImages,
    sandboxImageOptions: sandboxImage.options,
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
    trainingDataCaptureEnabled,
    traceEnabled: trainingDataCaptureEnabled,
    globalMounts: normalizeGlobalMounts(settings.globalMounts ?? config.globalMounts ?? []),
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
  const aSet = new Set(aMounts.map((m) => `${m.hostPath}\0${m.mode ?? "read-only"}`));
  for (const m of bMounts) {
    if (!aSet.has(`${m.hostPath}\0${m.mode ?? "read-only"}`)) return true;
  }
  return false;
}

function normalizeGlobalMounts(mounts: AppConfig["globalMounts"]): AppConfig["globalMounts"] {
  return mounts.map((mount) => ({
    hostPath: mount.hostPath,
    mode: mount.mode === "read-write" ? "read-write" : "read-only",
  }));
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

function clampParallelAgents(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(MAX_PARALLEL_AGENTS, Math.floor(value)));
}
