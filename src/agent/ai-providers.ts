import {
  axGetSupportedAIModels,
  type AxAIModelCatalogProvider,
} from "@ax-llm/ax";
import { DEFAULT_LOCAL_AGENT_MODEL_ID, LOCAL_AI_PROVIDER, MANAGED_LOCAL_CHAT_MODELS } from "../local-inference/manifest";

const AX_AI_MODEL_CATALOG = axGetSupportedAIModels({ type: "text" });

const AX_AI_PROVIDER_BY_NAME = new Map<string, AxAIModelCatalogProvider>(
  AX_AI_MODEL_CATALOG.map((provider) => [provider.name, provider]),
);

export const CUSTOM_OPENAI_PROVIDER = "custom-openai";
export const XAI_GROK_SUBSCRIPTION_PROVIDER = "xai-grok-subscription";
export const XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL = "grok-4.3";
export { LOCAL_AI_PROVIDER };

export const AX_AI_PROVIDERS: readonly string[] = [
  LOCAL_AI_PROVIDER,
  ...AX_AI_MODEL_CATALOG.map((provider) => provider.name),
  XAI_GROK_SUBSCRIPTION_PROVIDER,
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

export function isXaiGrokSubscriptionProvider(provider: string | undefined | null): boolean {
  return provider === XAI_GROK_SUBSCRIPTION_PROVIDER;
}

export function isLocalAiProvider(provider: string | undefined | null): boolean {
  return provider === LOCAL_AI_PROVIDER;
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
  if (isLocalAiProvider(provider)) return "Local";
  if (isXaiGrokSubscriptionProvider(provider)) return "xAI Grok Subscription";
  if (isCustomOpenAIProvider(provider)) return "Custom OpenAI";
  return AX_AI_PROVIDER_BY_NAME.get(provider)?.displayName ?? provider;
}

export function modelsForProvider(provider: string): readonly string[] {
  if (isLocalAiProvider(provider)) return MANAGED_LOCAL_CHAT_MODELS.map((model) => model.id);
  if (isXaiGrokSubscriptionProvider(provider)) return grokSubscriptionModels();
  if (isCustomOpenAIProvider(provider)) return [];
  return AX_AI_PROVIDER_MODELS[provider] ?? [];
}

export function defaultModelForProvider(provider: string): string {
  if (isLocalAiProvider(provider)) return DEFAULT_LOCAL_AGENT_MODEL_ID;
  if (isXaiGrokSubscriptionProvider(provider)) return XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL;
  if (isCustomOpenAIProvider(provider)) return "";
  return AX_AI_PROVIDER_BY_NAME.get(provider)?.defaultModel ?? "";
}

function grokSubscriptionModels(): readonly string[] {
  const grokModels = AX_AI_PROVIDER_MODELS.grok ?? [];
  return withPinnedModel(XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL, grokModels);
}

function withDefaultModel(
  model: string | undefined,
  models: readonly string[],
): readonly string[] {
  const deduped = [...new Set(models)];
  if (!model || deduped.includes(model)) return deduped;
  return [model, ...deduped];
}

function withPinnedModel(
  model: string,
  models: readonly string[],
): readonly string[] {
  return [model, ...[...new Set(models)].filter((candidate) => candidate !== model)];
}
