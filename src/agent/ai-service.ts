import { ai, type AxAIService } from "@ax-llm/ax";
import type { AppConfig } from "../config/env";

export type AiService = Readonly<AxAIService<unknown, unknown, string>>;

export function createAiService(config: AppConfig): AiService {
  return ai({
    name: config.aiProvider,
    apiKey: config.aiApiKey,
    config: config.aiModel ? { model: config.aiModel } : undefined,
  } as never) as AiService;
}

export function createFastAiService(config: AppConfig): AiService | undefined {
  if (!config.fastAiProvider) return undefined;
  return ai({
    name: config.fastAiProvider,
    apiKey: config.fastAiApiKey,
    config: config.fastAiModel ? { model: config.fastAiModel } : undefined,
  } as never) as AiService;
}
