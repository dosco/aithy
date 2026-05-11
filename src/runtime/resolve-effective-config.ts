import { loadConfig, type AppConfig } from "../config/env";
import { applyRuntimeSettings } from "../settings/resolve";
import { readProviderApiKey } from "../settings/secrets";
import type { StoredSettings } from "../settings/types";

export type RuntimeSecretOverrides = { apiKey?: string; fastApiKey?: string };

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
  return applyRuntimeSettings(baseConfig, settings.runtime, apiKey, fastApiKey);
}

export function loadBaseConfig(): AppConfig {
  return loadConfig(process.env, { traceEnabled: process.argv.includes("--trace") });
}
