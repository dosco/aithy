import { ai } from "@ax-llm/ax";
import type { AppConfig } from "../config/env";

export function createAiService(config: AppConfig): any {
  return ai({
    name: config.aiProvider,
    apiKey: config.aiApiKey,
    config: config.aiModel ? { model: config.aiModel } : undefined,
  } as any);
}

export function createFastAiService(config: AppConfig): any | undefined {
  if (!config.fastAiProvider) return undefined;
  return ai({
    name: config.fastAiProvider,
    apiKey: config.fastAiApiKey,
    config: config.fastAiModel ? { model: config.fastAiModel } : undefined,
  } as any);
}
