import type { AppConfig } from "./env";

const providersWithoutApiKey = new Set(["ollama"]);

export function assertStartupConfig(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.aiModel) missing.push("AITHY_AI_MODEL");
  if (requiresApiKey(config.aiProvider) && !config.aiApiKey) {
    missing.push("provider API key");
  }
  if (missing.length > 0) {
    throw new Error(`Aithy requires AI configuration: missing ${missing.join(", ")}`);
  }
}

function requiresApiKey(provider: string): boolean {
  return !providersWithoutApiKey.has(provider);
}
