import { a as testAiChat } from "../../src/agent/ai-smoke-test";
import { isLocalAiProvider, isXaiGrokSubscriptionProvider } from "../../src/agent/ai-providers";
import type { AppConfig } from "../../src/config/env";
import { aiConfigurationIssues, fastAiConfigurationIssues } from "../../src/config/validate";
import { isMeshInferenceProvider } from "../../src/mesh/types";
import { aiProfileFor } from "../../src/settings/provider-profiles";
import { normalizePostedSecret, readProviderApiKey } from "../../src/settings/secrets";
import type { RuntimeSettings } from "../../src/settings/types";

type AiSmokeTest = typeof testAiChat;

export interface AiSettingsTestInput {
  runtime?: RuntimeSettings;
  apiKey?: string;
  clearApiKey?: boolean;
  clearAiModel?: boolean;
  fastApiKey?: string;
  clearFastApiKey?: boolean;
}

export interface AiSettingsTestDeps {
  testAiChat?: AiSmokeTest;
}

export async function assertAiSettings(
  config: AppConfig,
  input: AiSettingsTestInput,
  deps: AiSettingsTestDeps = {},
): Promise<void> {
  await assertPrimaryAiSettings(config, input, deps);
  await assertFastAiSettings(config, input, deps);
}

export async function assertPrimaryAiSettings(
  config: AppConfig,
  input: AiSettingsTestInput,
  deps: AiSettingsTestDeps = {},
): Promise<void> {
  if (input.clearApiKey || input.clearAiModel) return;
  const provider = input.runtime?.aiProvider?.trim() || config.aiProvider;
  const profile = input.runtime ? aiProfileFor(input.runtime, provider) : {};
  const apiUrl = profile.apiUrl?.trim() || input.runtime?.aiApiUrl?.trim() || config.aiApiUrl;
  const model = profile.model?.trim() || input.runtime?.aiModel?.trim() || config.aiModel;
  const profileArgs = input.runtime?.aiProfileArgs ?? profile.profileArgs ?? config.aiProfileArgs;
  const thinkingLevel = input.runtime?.aiThinkingLevel === null
    ? undefined
    : input.runtime?.aiThinkingLevel ?? profile.thinkingLevel ?? config.aiThinkingLevel;
  const serviceTier = input.runtime?.aiServiceTier ?? profile.serviceTier ?? config.aiServiceTier;
  const apiKey = normalizePostedSecret(input.apiKey);
  const storedApiKey =
    provider === config.aiProvider ? config.aiApiKey : await readProviderApiKey(provider, config.botId);
  const nextConfig = {
    ...config,
    aiProvider: provider,
    aiApiUrl: apiUrl,
    aiModel: model,
    aiApiKey: apiKey || storedApiKey,
    aiProfileArgs: profileArgs,
    aiThinkingLevel: thinkingLevel ?? undefined,
    aiServiceTier: serviceTier,
  };
  const missing = aiConfigurationIssues(nextConfig);
  if (missing.length > 0) {
    throw new Error(`AI settings require ${missing.join(", ")}`);
  }
  if (isLocalAiProvider(provider) || isMeshInferenceProvider(provider) || isXaiGrokSubscriptionProvider(provider)) return;
  if (
    !apiKey
    && provider === config.aiProvider
    && apiUrl === config.aiApiUrl
    && model === config.aiModel
    && sameRecord(profileArgs, config.aiProfileArgs)
    && thinkingLevel === config.aiThinkingLevel
    && serviceTier === config.aiServiceTier
  ) return;

  await (deps.testAiChat ?? testAiChat)(nextConfig);
}

export async function assertFastAiSettings(
  config: AppConfig,
  input: AiSettingsTestInput,
  deps: AiSettingsTestDeps = {},
): Promise<void> {
  if (input.clearApiKey || input.clearAiModel) return;
  const fastProvider = input.runtime?.fastAiProvider?.trim() ?? config.fastAiProvider;
  if (!fastProvider) return;
  const fastProfile = input.runtime ? aiProfileFor(input.runtime, fastProvider) : {};

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
    fastAiApiUrl: fastProfile.fastApiUrl?.trim() || fastProfile.apiUrl?.trim() || input.runtime?.fastAiApiUrl?.trim() || config.fastAiApiUrl,
    fastAiModel: fastProfile.fastModel?.trim() || input.runtime?.fastAiModel?.trim() || config.fastAiModel,
    fastAiProfileArgs: input.runtime?.fastAiProfileArgs
      ?? fastProfile.fastProfileArgs
      ?? fastProfile.profileArgs
      ?? config.fastAiProfileArgs,
    fastAiThinkingLevel: input.runtime?.fastAiThinkingLevel === null
      ? undefined
      : input.runtime?.fastAiThinkingLevel ?? fastProfile.fastThinkingLevel ?? config.fastAiThinkingLevel,
    fastAiServiceTier: input.runtime?.fastAiServiceTier
      ?? fastProfile.fastServiceTier
      ?? config.fastAiServiceTier,
    fastAiApiKey: input.clearFastApiKey ? undefined : postedFastKey || storedFastKey,
  };
  const missing = fastAiConfigurationIssues(nextConfig);
  if (missing.length > 0) {
    throw new Error(`AI settings require ${missing.join(", ")}`);
  }
  if (isLocalAiProvider(fastProvider) || isMeshInferenceProvider(fastProvider) || isXaiGrokSubscriptionProvider(fastProvider)) return;
  const shouldSmokeTest = Boolean(postedFastKey || (fastProvider === primaryProvider && postedPrimaryKey))
    || fastProvider !== config.fastAiProvider
    || nextConfig.fastAiApiUrl !== config.fastAiApiUrl
    || nextConfig.fastAiModel !== config.fastAiModel
    || !sameRecord(nextConfig.fastAiProfileArgs, config.fastAiProfileArgs)
    || nextConfig.fastAiThinkingLevel !== config.fastAiThinkingLevel
    || nextConfig.fastAiServiceTier !== config.fastAiServiceTier;
  if (!shouldSmokeTest) return;
  await (deps.testAiChat ?? testAiChat)({
    ...nextConfig,
    aiProvider: fastProvider,
    aiApiUrl: nextConfig.fastAiApiUrl,
    aiApiKey: nextConfig.fastAiApiKey,
    aiModel: nextConfig.fastAiModel,
    aiProfileArgs: nextConfig.fastAiProfileArgs,
    aiThinkingLevel: nextConfig.fastAiThinkingLevel,
    aiServiceTier: nextConfig.fastAiServiceTier,
  });
}

function sameRecord(
  a: Readonly<Record<string, string>> | undefined,
  b: Readonly<Record<string, string>> | undefined,
): boolean {
  return JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
}
