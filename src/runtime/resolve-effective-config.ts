import { loadConfig, type AppConfig } from "../config/env";
import { grokSubscriptionStatus } from "../grok-subscription/store";
import { activeSearchProvider } from "../settings/provider-profiles";
import { applyRuntimeSettings } from "../settings/resolve";
import { readProviderApiKey, readSearchApiKey } from "../settings/secrets";
import type { StoredSettings } from "../settings/types";
import { meshProxyUrlFromState } from "../mesh/proxy-url";
import { isMeshInferenceProvider, isMeshSearchProvider } from "../mesh/types";

export type RuntimeSecretOverrides = {
  apiKey?: string;
  fastApiKey?: string;
  parallelApiKey?: string;
};

export async function resolveEffectiveConfig(
  baseConfig: AppConfig,
  settings: StoredSettings,
  secrets: RuntimeSecretOverrides = {},
): Promise<AppConfig> {
  const provider = settings.runtime.aiProvider?.trim() || baseConfig.aiProvider;
  const apiKey =
    settings.runtime.aiApiKey === null
      ? null
      : baseConfig.aiApiKey ?? secrets.apiKey ?? await readProviderApiKey(provider, baseConfig.botId);
  const fastProvider = settings.runtime.fastAiProvider?.trim();
  const fastApiKey = fastProvider
    ? (fastProvider === provider ? apiKey : secrets.fastApiKey ?? await readProviderApiKey(fastProvider, baseConfig.botId))
    : undefined;
  const parallelApiKey =
    settings.runtime.parallelApiKey === null
      ? null
      : secrets.parallelApiKey ?? await readSearchApiKey(activeSearchProvider(settings.runtime), baseConfig.botId) ?? baseConfig.parallelApiKey;
  const grok = await grokSubscriptionStatus(baseConfig.botId, baseConfig.stateDbPath);
  const applied = applyRuntimeSettings(baseConfig, settings.runtime, apiKey, fastApiKey, parallelApiKey);
  const meshAiUrl = isMeshInferenceProvider(applied.aiProvider)
    ? meshProxyUrlFromState(baseConfig.stateDbPath, applied.aiProvider)
    : undefined;
  const meshFastUrl = isMeshInferenceProvider(applied.fastAiProvider)
    ? meshProxyUrlFromState(baseConfig.stateDbPath, applied.fastAiProvider ?? "")
    : undefined;
  const meshSearchUrl = isMeshSearchProvider(applied.searchProvider)
    ? meshProxyUrlFromState(baseConfig.stateDbPath, applied.searchProvider ?? "")
    : undefined;
  return {
    ...applied,
    aiApiUrl: meshAiUrl ?? applied.aiApiUrl,
    fastAiApiUrl: meshFastUrl ?? applied.fastAiApiUrl,
    searchApiUrl: meshSearchUrl,
    grokSubscriptionConnected: grok.connected,
  };
}

export function loadBaseConfig(): AppConfig {
  return loadConfig({ traceEnabled: process.argv.includes("--trace") });
}
