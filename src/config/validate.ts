import type { AppConfig } from "./env";
import { isCustomOpenAIProvider, isXaiGrokSubscriptionProvider } from "../agent/ai-providers";

const providersWithoutApiKey = new Set(["ollama", "local", "xai-grok-subscription"]);

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
  if (isCustomOpenAIProvider(config.aiProvider) && !config.aiApiUrl) {
    missing.push("OpenAI-compatible base URL");
  }
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
  if (isCustomOpenAIProvider(config.fastAiProvider) && !config.fastAiApiUrl) {
    missing.push("fast OpenAI-compatible base URL");
  }
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
  return !providersWithoutApiKey.has(provider);
}
