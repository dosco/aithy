import type { AppConfig } from "./env";
import {
  isXaiGrokSubscriptionProvider,
  missingProfileConfiguration,
  normalizeServiceTierForSelection,
  normalizeThinkingLevelForSelection,
  providerAuthentication,
} from "../agent/ai-providers";

/**
 * Non-throwing predicate: does this config have everything the agent needs to
 * actually run? Drives the /setup gate in the UI.
 */
export function isAiConfigured(config: AppConfig): boolean {
  return aiConfigurationIssues(config).length === 0;
}

export function aiConfigurationIssues(config: AppConfig): string[] {
  const missing: string[] = [];
  if (!config.aiModel) missing.push("model");
  missing.push(...missingProfileConfiguration(config.aiProvider, config.aiApiUrl, config.aiProfileArgs));
  if (
    config.aiThinkingLevel
    && normalizeThinkingLevelForSelection(config.aiProvider, config.aiModel, config.aiThinkingLevel) !== config.aiThinkingLevel
  ) missing.push("supported thinking level");
  if (
    config.aiServiceTier
    && normalizeServiceTierForSelection(config.aiProvider, config.aiModel, config.aiServiceTier) !== config.aiServiceTier
  ) missing.push("supported service tier");
  if (requiresApiKey(config.aiProvider) && !config.aiApiKey) {
    missing.push("provider API key");
  }
  if (isXaiGrokSubscriptionProvider(config.aiProvider) && !config.grokSubscriptionConnected) {
    missing.push("Grok subscription sign-in");
  }
  return missing;
}

export function fastAiConfigurationIssues(config: AppConfig): string[] {
  if (!config.fastAiProvider) return [];
  const missing: string[] = [];
  missing.push(...missingProfileConfiguration(
    config.fastAiProvider,
    config.fastAiApiUrl,
    config.fastAiProfileArgs,
  ).map((issue) => `fast ${issue}`));
  if (
    config.fastAiThinkingLevel
    && normalizeThinkingLevelForSelection(
      config.fastAiProvider,
      config.fastAiModel,
      config.fastAiThinkingLevel,
    ) !== config.fastAiThinkingLevel
  ) missing.push("supported fast thinking level");
  if (
    config.fastAiServiceTier
    && normalizeServiceTierForSelection(
      config.fastAiProvider,
      config.fastAiModel,
      config.fastAiServiceTier,
    ) !== config.fastAiServiceTier
  ) missing.push("supported fast service tier");
  const fastApiKey = config.fastAiProvider === config.aiProvider
    ? config.fastAiApiKey ?? config.aiApiKey
    : config.fastAiApiKey;
  if (requiresApiKey(config.fastAiProvider) && !fastApiKey) {
    missing.push("fast provider API key");
  }
  if (isXaiGrokSubscriptionProvider(config.fastAiProvider) && !config.grokSubscriptionConnected) {
    missing.push("fast Grok subscription sign-in");
  }
  return missing;
}

export function assertStartupConfig(config: AppConfig): void {
  const missing = aiConfigurationIssues(config);
  if (missing.length === 0) return;
  throw new Error(`Aithy requires AI configuration: missing ${missing.join(", ")}`);
}

export function providerRequiresApiKey(provider: string): boolean {
  return requiresApiKey(provider);
}

function requiresApiKey(provider: string): boolean {
  if (provider.startsWith("mesh:")) return false;
  return providerAuthentication(provider) === "required";
}
