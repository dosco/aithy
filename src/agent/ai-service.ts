import { ai, type AxAIService } from "@ax-llm/ax";
import type { AppConfig } from "../config/env";
import { fastAiConfigurationIssues } from "../config/validate";
import { isCustomOpenAIProvider } from "./ai-providers";

export type AiService = Readonly<AxAIService<unknown, unknown, string>>;

export function createAiService(config: AppConfig): AiService {
  return ai({
    name: aiServiceProviderName(config.aiProvider),
    apiURL: config.aiApiUrl,
    apiKey: config.aiApiKey,
    config: config.aiModel ? { model: config.aiModel } : undefined,
  } as never) as AiService;
}

export function createFastAiService(config: AppConfig): AiService | undefined {
  if (!config.fastAiProvider) return undefined;
  if (fastAiConfigurationIssues(config).length > 0) return undefined;
  const apiKey = config.fastAiProvider === config.aiProvider
    ? config.fastAiApiKey ?? config.aiApiKey
    : config.fastAiApiKey;
  return ai({
    name: aiServiceProviderName(config.fastAiProvider),
    apiURL: config.fastAiApiUrl,
    apiKey,
    config: config.fastAiModel ? { model: config.fastAiModel } : undefined,
  } as never) as AiService;
}

function aiServiceProviderName(provider: string): string {
  return isCustomOpenAIProvider(provider) ? "openai" : provider;
}
