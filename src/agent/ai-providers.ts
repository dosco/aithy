import {
  axAIProfiles,
  axGetSupportedAIModels,
  type AxAIModelCatalogModelCapabilities,
  type AxAIModelCatalogProvider,
  type AxAIModelCatalogThinkingLevel,
  type AxAIProfileSummary,
  type AxServiceTier,
} from "@ax-llm/ax";
import { isMeshInferenceProvider } from "../mesh/types";
import { DEFAULT_LOCAL_AGENT_MODEL_ID, LOCAL_AI_PROVIDER, MANAGED_LOCAL_CHAT_MODELS } from "../local-inference/manifest";

const AX_AI_MODEL_CATALOG = axGetSupportedAIModels({ type: "text" });
const AX_AI_FULL_MODEL_CATALOG = axGetSupportedAIModels();
const AX_AI_PROFILE_CATALOG = axAIProfiles();

const AX_AI_PROVIDER_BY_NAME = new Map<string, AxAIModelCatalogProvider>(
  AX_AI_MODEL_CATALOG.map((provider) => [provider.name, provider]),
);
const AX_AI_FULL_PROVIDER_BY_NAME = new Map<string, AxAIModelCatalogProvider>(
  AX_AI_FULL_MODEL_CATALOG.map((provider) => [provider.name, provider]),
);
const AX_AI_PROFILE_BY_NAME = new Map<string, AxAIProfileSummary>(
  AX_AI_PROFILE_CATALOG.map((profile) => [profile.id, profile]),
);

export const CUSTOM_OPENAI_PROVIDER = "custom-openai";
export const XAI_GROK_SUBSCRIPTION_PROVIDER = "xai-grok-subscription";
export const XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL = "grok-4.3";
export { LOCAL_AI_PROVIDER };

export const AX_AI_PROVIDERS: readonly string[] = [
  LOCAL_AI_PROVIDER,
  ...AX_AI_MODEL_CATALOG
    .filter((provider) => provider.name !== "webllm")
    .map((provider) => provider.name),
  XAI_GROK_SUBSCRIPTION_PROVIDER,
  CUSTOM_OPENAI_PROVIDER,
];

/** Providers offered for new selections. Legacy custom-openai remains readable but is replaced by Ax's profile. */
export const AX_AI_SELECTABLE_PROVIDERS: readonly string[] = AX_AI_PROVIDERS.filter(
  (provider) => provider !== CUSTOM_OPENAI_PROVIDER,
);

export type AxAiProviderName = (typeof AX_AI_PROVIDERS)[number];
export type AiThinkingLevel = AxAIModelCatalogThinkingLevel;
export type AiServiceTier = AxServiceTier;
export type AiProviderAuthentication = "required" | "optional" | "none";

export interface AiProviderEndpointField {
  name: string;
  label: string;
  required: boolean;
  defaultValue?: string;
}

export interface AiSelectionCapabilities {
  thinkingLevels: readonly AiThinkingLevel[];
  serviceTiers: readonly Exclude<AiServiceTier, "auto">[];
}

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
  if (isMeshInferenceProvider(provider)) return "Family Aithy";
  if (isLocalAiProvider(provider)) return "Local";
  if (isXaiGrokSubscriptionProvider(provider)) return "xAI Grok Subscription";
  if (isCustomOpenAIProvider(provider)) return "Custom OpenAI";
  return AX_AI_PROVIDER_BY_NAME.get(provider)?.displayName ?? provider;
}

export function providerAuthentication(provider: string): AiProviderAuthentication {
  if (isLocalAiProvider(provider) || isMeshInferenceProvider(provider) || isXaiGrokSubscriptionProvider(provider)) {
    return "none";
  }
  if (isCustomOpenAIProvider(provider)) return "required";
  const authentication = AX_AI_PROFILE_BY_NAME.get(provider)?.authentication;
  if (!authentication) return "required";
  if (authentication.type === "none") return "none";
  return authentication.required ? "required" : "optional";
}

export function providerUsesApiUrl(provider: string): boolean {
  if (isCustomOpenAIProvider(provider)) return true;
  return AX_AI_PROFILE_BY_NAME.get(provider)?.requiresApiURL === true;
}

export function isDynamicAiProvider(provider: string): boolean {
  return AX_AI_FULL_PROVIDER_BY_NAME.get(provider)?.isDynamic === true;
}

export function endpointFieldsForProvider(provider: string): readonly AiProviderEndpointField[] {
  const endpoint = AX_AI_PROFILE_BY_NAME.get(provider)?.endpoint;
  if (!endpoint) return [];
  const names = new Set([
    ...Object.keys(endpoint.fields ?? {}),
    ...endpoint.required,
    ...Object.keys(endpoint.defaults ?? {}),
  ]);
  return [...names].map((name) => ({
    name,
    label: humanizeProfileField(name),
    required: endpoint.required.includes(name),
    ...(endpoint.defaults?.[name] ? { defaultValue: endpoint.defaults[name] } : {}),
  }));
}

export function normalizeProfileArgs(
  provider: string,
  value: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  const allowed = new Set(endpointFieldsForProvider(provider).map((field) => field.name));
  const entries = Object.entries(value ?? {})
    .filter(([key]) => allowed.has(key))
    .map(([key, fieldValue]) => [key, fieldValue.trim()] as const)
    .filter(([, fieldValue]) => Boolean(fieldValue));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function missingProfileConfiguration(
  provider: string,
  apiUrl: string | undefined,
  profileArgs: Readonly<Record<string, string>> | undefined,
): string[] {
  const missing: string[] = [];
  if (providerUsesApiUrl(provider) && !apiUrl?.trim()) missing.push(`${providerDisplayName(provider)} base URL`);
  for (const field of endpointFieldsForProvider(provider)) {
    if (!field.required || profileArgs?.[field.name]?.trim() || field.defaultValue) continue;
    missing.push(`${providerDisplayName(provider)} ${field.label.toLowerCase()}`);
  }
  return missing;
}

export function capabilitiesForProviderModel(
  provider: string,
  model: string | undefined,
): AiSelectionCapabilities {
  if (
    isLocalAiProvider(provider)
    || isMeshInferenceProvider(provider)
    || isXaiGrokSubscriptionProvider(provider)
    || isCustomOpenAIProvider(provider)
  ) {
    return emptyCapabilities();
  }
  const catalogProvider = AX_AI_FULL_PROVIDER_BY_NAME.get(provider);
  if (!catalogProvider) return emptyCapabilities();
  const selectedModel = model?.trim();
  const catalogModel = selectedModel
    ? catalogProvider.models.find((candidate) =>
      candidate.name === selectedModel || candidate.aliases?.includes(selectedModel)
    )
    : undefined;
  if (catalogModel) return selectionCapabilities(catalogModel.capabilities);
  if (catalogProvider.isDynamic || !selectedModel || selectedModel === catalogProvider.defaultModel) {
    return selectionCapabilities(catalogProvider.capabilities);
  }
  return emptyCapabilities();
}

export function normalizeThinkingLevelForSelection(
  provider: string,
  model: string | undefined,
  value: AiThinkingLevel | "" | null | undefined,
): AiThinkingLevel | undefined {
  if (!value) return undefined;
  return capabilitiesForProviderModel(provider, model).thinkingLevels.includes(value) ? value : undefined;
}

export function normalizeServiceTierForSelection(
  provider: string,
  model: string | undefined,
  value: AiServiceTier | undefined,
): AiServiceTier | undefined {
  const tiers = capabilitiesForProviderModel(provider, model).serviceTiers;
  if (tiers.length === 0) return undefined;
  if (!value || value === "auto") return "auto";
  return tiers.includes(value) ? value : "auto";
}

export function modelsForProvider(provider: string): readonly string[] {
  if (isMeshInferenceProvider(provider)) return [];
  if (isLocalAiProvider(provider)) return MANAGED_LOCAL_CHAT_MODELS.map((model) => model.id);
  if (isXaiGrokSubscriptionProvider(provider)) return grokSubscriptionModels();
  if (isCustomOpenAIProvider(provider)) return [];
  return AX_AI_PROVIDER_MODELS[provider] ?? [];
}

export function defaultModelForProvider(provider: string): string {
  if (isMeshInferenceProvider(provider)) return "";
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

function selectionCapabilities(
  capabilities: Pick<AxAIModelCatalogModelCapabilities, "thinkingLevels" | "serviceTiers">,
): AiSelectionCapabilities {
  return {
    thinkingLevels: [...capabilities.thinkingLevels],
    serviceTiers: capabilities.serviceTiers.filter(
      (tier): tier is Exclude<AiServiceTier, "auto"> => tier !== "auto",
    ),
  };
}

function emptyCapabilities(): AiSelectionCapabilities {
  return { thinkingLevels: [], serviceTiers: [] };
}

function humanizeProfileField(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
