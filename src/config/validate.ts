import type { AppConfig } from "./env";

const providersWithoutApiKey = new Set(["ollama"]);

/**
 * Non-throwing predicate: does this config have everything the agent needs to
 * actually run? Drives the /setup gate in the UI.
 */
export function isAiConfigured(config: AppConfig): boolean {
  if (!config.aiModel) return false;
  if (requiresApiKey(config.aiProvider) && !config.aiApiKey) return false;
  return true;
}

export function assertStartupConfig(config: AppConfig): void {
  if (isAiConfigured(config)) return;
  const missing: string[] = [];
  if (!config.aiModel) missing.push("AITHY_AI_MODEL");
  if (requiresApiKey(config.aiProvider) && !config.aiApiKey) {
    missing.push("provider API key");
  }
  throw new Error(`Aithy requires AI configuration: missing ${missing.join(", ")}`);
}

function requiresApiKey(provider: string): boolean {
  return !providersWithoutApiKey.has(provider);
}
