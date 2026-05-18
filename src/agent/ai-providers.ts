import {
  axGetSupportedAIModels,
  type AxAIModelCatalogProvider,
} from "@ax-llm/ax";

const AX_AI_MODEL_CATALOG = axGetSupportedAIModels({ type: "text" });

const AX_AI_PROVIDER_BY_NAME = new Map<string, AxAIModelCatalogProvider>(
  AX_AI_MODEL_CATALOG.map((provider) => [provider.name, provider]),
);

export const CUSTOM_OPENAI_PROVIDER = "custom-openai";

export const AX_AI_PROVIDERS: readonly string[] = [
  ...AX_AI_MODEL_CATALOG.map((provider) => provider.name),
  CUSTOM_OPENAI_PROVIDER,
];

export type AxAiProviderName = (typeof AX_AI_PROVIDERS)[number];

export const DEFAULT_OPENAI_MODEL =
  AX_AI_PROVIDER_BY_NAME.get("openai")?.defaultModel ?? "";

export function isAxAiProvider(value: string): value is AxAiProviderName {
  return (AX_AI_PROVIDERS as readonly string[]).includes(value);
}

export function isCustomOpenAIProvider(provider: string): boolean {
  return provider === CUSTOM_OPENAI_PROVIDER;
}

export const AX_AI_PROVIDER_MODELS: Record<string, readonly string[]> = {
  ...Object.fromEntries(
    AX_AI_MODEL_CATALOG.map((provider) => [
      provider.name,
      withDefaultModel(
        provider.defaultModel,
        provider.models.map((model) => model.name),
      ),
    ]),
  ),
};

export function providerDisplayName(provider: string): string {
  if (isCustomOpenAIProvider(provider)) return "Custom OpenAI";
  return AX_AI_PROVIDER_BY_NAME.get(provider)?.displayName ?? provider;
}

export function modelsForProvider(provider: string): readonly string[] {
  if (isCustomOpenAIProvider(provider)) return [];
  return AX_AI_PROVIDER_MODELS[provider] ?? [];
}

export function defaultModelForProvider(provider: string): string {
  if (isCustomOpenAIProvider(provider)) return "";
  return AX_AI_PROVIDER_BY_NAME.get(provider)?.defaultModel ?? "";
}

function withDefaultModel(
  model: string | undefined,
  models: readonly string[],
): readonly string[] {
  const deduped = [...new Set(models)];
  if (!model || deduped.includes(model)) return deduped;
  return [model, ...deduped];
}
