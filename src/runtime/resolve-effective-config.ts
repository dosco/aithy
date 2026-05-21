import { loadConfig, type AppConfig } from "../config/env";
import { grokSubscriptionStatus } from "../grok-subscription/store";
import { applyRuntimeSettings } from "../settings/resolve";
import { readParallelApiKey, readProviderApiKey } from "../settings/secrets";
import type { StoredSettings } from "../settings/types";

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
      : secrets.parallelApiKey ?? await readParallelApiKey(baseConfig.botId) ?? baseConfig.parallelApiKey;
  const grok = await grokSubscriptionStatus(baseConfig.botId, baseConfig.stateDbPath);
  return {
    ...applyRuntimeSettings(baseConfig, settings.runtime, apiKey, fastApiKey, parallelApiKey),
    grokSubscriptionConnected: grok.connected,
  };
}

export function loadBaseConfig(): AppConfig {
  return loadConfig({ traceEnabled: process.argv.includes("--trace") });
}
