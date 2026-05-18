import { a as testAiChat } from "../../src/agent/ai-smoke-test";
import type { AppConfig } from "../../src/config/env";
import { aiConfigurationIssues, fastAiConfigurationIssues } from "../../src/config/validate";
import { normalizePostedSecret, readProviderApiKey } from "../../src/settings/secrets";
import type { RuntimeSettings } from "../../src/settings/types";

export interface AiSettingsTestInput {
  runtime?: RuntimeSettings;
  apiKey?: string;
  clearApiKey?: boolean;
  clearAiModel?: boolean;
  fastApiKey?: string;
  clearFastApiKey?: boolean;
}

export async function assertAiSettings(
  config: AppConfig,
  input: AiSettingsTestInput,
): Promise<void> {
  await assertPrimaryAiSettings(config, input);
  await assertFastAiSettings(config, input);
}

export async function assertPrimaryAiSettings(
  config: AppConfig,
  input: AiSettingsTestInput,
): Promise<void> {
  if (input.clearApiKey || input.clearAiModel) return;
  const provider = input.runtime?.aiProvider?.trim() || config.aiProvider;
  const apiUrl = input.runtime?.aiApiUrl?.trim() || config.aiApiUrl;
  const model = input.runtime?.aiModel?.trim() || config.aiModel;
  const apiKey = normalizePostedSecret(input.apiKey);
  const storedApiKey =
    provider === config.aiProvider ? config.aiApiKey : await readProviderApiKey(provider, config.botId);
  const nextConfig = {
    ...config,
    aiProvider: provider,
    aiApiUrl: apiUrl,
    aiModel: model,
    aiApiKey: apiKey || storedApiKey,
  };
  const missing = aiConfigurationIssues(nextConfig);
  if (missing.length > 0) {
    throw new Error(`AI settings require ${missing.join(", ")}`);
  }
  if (
    !apiKey
    && provider === config.aiProvider
    && apiUrl === config.aiApiUrl
    && model === config.aiModel
  ) return;

  await testAiChat(nextConfig);
}

export async function assertFastAiSettings(
  config: AppConfig,
  input: AiSettingsTestInput,
): Promise<void> {
  if (input.clearApiKey || input.clearAiModel) return;
  const fastProvider = input.runtime?.fastAiProvider?.trim() ?? config.fastAiProvider;
  if (!fastProvider) return;

  const primaryProvider = input.runtime?.aiProvider?.trim() || config.aiProvider;
  const postedPrimaryKey = normalizePostedSecret(input.apiKey);
  const primaryStoredKey =
    input.clearApiKey
      ? undefined
      : primaryProvider === config.aiProvider
        ? config.aiApiKey
        : await readProviderApiKey(primaryProvider, config.botId);
  const primaryKey = postedPrimaryKey || primaryStoredKey;
  const postedFastKey = normalizePostedSecret(input.fastApiKey);
  const storedFastKey =
    fastProvider === primaryProvider
      ? primaryKey
      : fastProvider === config.fastAiProvider
        ? config.fastAiApiKey
        : await readProviderApiKey(fastProvider, config.botId);
  const nextConfig = {
    ...config,
    aiProvider: primaryProvider,
    aiApiKey: primaryKey,
    fastAiProvider: fastProvider,
    fastAiApiUrl: input.runtime?.fastAiApiUrl?.trim() || config.fastAiApiUrl,
    fastAiModel: input.runtime?.fastAiModel?.trim() || config.fastAiModel,
    fastAiApiKey: input.clearFastApiKey ? undefined : postedFastKey || storedFastKey,
  };
  const missing = fastAiConfigurationIssues(nextConfig);
  if (missing.length > 0) {
    throw new Error(`AI settings require ${missing.join(", ")}`);
  }
}
