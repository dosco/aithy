import {
  isCustomOpenAIProvider,
  isLocalAiProvider,
  isXaiGrokSubscriptionProvider,
  providerDisplayName,
} from "../agent/ai-providers";
import type { AppConfig } from "../config/env";
import { providerRequiresApiKey } from "../config/validate";
import { resolveLocalInferenceConfig } from "../runtime/local-inference-config";
import type { RuntimeStore } from "../runtime/runtime-store";
import {
  aiProfileFor,
  searchProfileFor,
} from "../settings/provider-profiles";
import {
  BunSecretStore,
  readProviderApiKey,
  readSearchApiKey,
  type SecretStore,
} from "../settings/secrets";
import type {
  AiProviderProfile,
  ProviderValidationState,
  RuntimeSettings,
  SearchProviderId,
  SearchProviderMode,
  SearchProviderProfile,
} from "../settings/types";
import {
  isMeshProvider,
  type MeshCatalogValidation,
  type MeshLiveCatalog,
  type MeshLiveInferenceService,
  type MeshLiveSearchService,
  type MeshSharingSettings,
} from "./types";

interface CatalogInput {
  config: AppConfig;
  settings: RuntimeSettings;
  sharing: MeshSharingSettings;
  runtimeStore?: RuntimeStore;
  secrets?: SecretStore;
}

interface InferenceOffering {
  service: MeshLiveInferenceService;
  config: AppConfig;
  model: string;
}

interface SearchOffering {
  service: MeshLiveSearchService;
  config: AppConfig;
}

export async function localMeshLiveCatalog(input: CatalogInput): Promise<MeshLiveCatalog> {
  const [inference, search] = await Promise.all([
    localInferenceOfferings(input),
    localSearchOfferings(input),
  ]);
  return {
    inference: inference.map((item) => item.service),
    search: search.map((item) => item.service),
    fetchedAt: new Date().toISOString(),
  };
}

export async function resolveMeshInferenceService(input: CatalogInput & {
  serviceId: string;
  requestedModel?: string | null;
}): Promise<AppConfig> {
  const offering = (await localInferenceOfferings(input)).find((item) => item.service.id === input.serviceId);
  if (!offering) throw new Error("Mesh inference service is not offered here.");
  const model = input.requestedModel?.trim() || offering.model;
  if (!offering.service.models.some((candidate) => candidate.id === model)) {
    throw new Error("Requested model is not offered by this mesh service.");
  }
  return { ...offering.config, aiModel: offering.model };
}

export async function resolveMeshSearchService(input: CatalogInput & { serviceId: string }): Promise<AppConfig> {
  const offering = (await localSearchOfferings(input)).find((item) => item.service.id === input.serviceId);
  if (!offering) throw new Error("Mesh search service is not offered here.");
  return offering.config;
}

async function localInferenceOfferings(input: CatalogInput): Promise<InferenceOffering[]> {
  if (!input.sharing.inference) return [];
  const offerings: InferenceOffering[] = [];
  for (const provider of Object.keys(input.settings.aiProviderProfiles ?? {}).sort()) {
    if (isMeshProvider(provider)) continue;
    const profile = aiProfileFor(input.settings, provider);
    const key = await providerApiKey(provider, input.config, input.secrets);
    for (const slot of inferenceSlots(profile)) {
      const model = slot.model?.trim();
      if (!model) continue;
      const apiUrl = slot.apiUrl?.trim();
      if (isCustomOpenAIProvider(provider) && !apiUrl) continue;
      if (providerRequiresApiKey(provider) && !key) continue;
      if (!serviceUsable(provider, model, slot.validation, input)) continue;
      offerings.push({
        model,
        config: {
          ...input.config,
          aiProvider: provider,
          aiApiUrl: apiUrl || undefined,
          aiApiKey: key,
          aiModel: model,
          localAgentModel: isLocalAiProvider(provider) ? model : input.config.localAgentModel,
        },
        service: {
          id: meshServiceId(provider, slot.slot),
          providerId: provider,
          providerLabel: providerDisplayName(provider),
          slot: slot.slot,
          slotLabel: slot.slot === "fast" ? "Fast" : "Primary",
          models: [{ id: model, label: model }],
          validation: validationMetadata(slot.validation),
        },
      });
    }
  }
  return offerings;
}

async function localSearchOfferings(input: CatalogInput): Promise<SearchOffering[]> {
  if (!input.sharing.search) return [];
  const offerings: SearchOffering[] = [];
  const parallel = await parallelSearchOffering(input);
  if (parallel) offerings.push(parallel);
  const grok = grokSearchOffering(input);
  if (grok) offerings.push(grok);
  return offerings;
}

async function parallelSearchOffering(input: CatalogInput): Promise<SearchOffering | null> {
  const provider: SearchProviderId = "parallel";
  const profile = searchProfileFor(input.settings, provider);
  if (profile.validation?.status !== "valid") return null;
  const url = profile.url?.trim() || input.config.parallelSearchMcpUrl;
  if (!url) return null;
  const key = await readSearchApiKey(provider, input.config.botId, input.secrets ?? BunSecretStore)
    ?? input.config.parallelApiKey;
  const mode = profile.mode === "api-key"
    ? "api-key"
    : profile.mode === "anonymous"
      ? "anonymous"
      : key ? "api-key" : "anonymous";
  if (mode === "api-key" && !key) return null;
  return {
    config: {
      ...input.config,
      searchProvider: provider,
      parallelSearchMcpUrl: url,
      parallelApiKey: mode === "api-key" ? key : undefined,
    },
    service: {
      id: meshServiceId(provider, "search"),
      providerId: provider,
      providerLabel: "Parallel",
      mode,
      validation: validationMetadata(profile.validation),
    },
  };
}

function grokSearchOffering(input: CatalogInput): SearchOffering | null {
  const provider: SearchProviderId = "grok-subscription";
  const profile = searchProfileFor(input.settings, provider);
  if (!validated(profile.validation) || !input.config.grokSubscriptionConnected) return null;
  return {
    config: {
      ...input.config,
      searchProvider: provider,
      grokSubscriptionConnected: true,
    },
    service: {
      id: meshServiceId(provider, "search"),
      providerId: provider,
      providerLabel: "Grok subscription",
      mode: "grok-subscription",
      validation: validationMetadata(profile.validation),
    },
  };
}

function inferenceSlots(profile: AiProviderProfile): Array<{
  slot: "primary" | "fast";
  model?: string | null;
  apiUrl?: string | null;
  validation?: ProviderValidationState;
}> {
  return [
    { slot: "primary", model: profile.model, apiUrl: profile.apiUrl, validation: profile.validation },
    { slot: "fast", model: profile.fastModel, apiUrl: profile.fastApiUrl ?? profile.apiUrl, validation: profile.fastValidation },
  ];
}

function serviceUsable(
  provider: string,
  model: string,
  validation: ProviderValidationState | undefined,
  input: CatalogInput,
): boolean {
  if (isLocalAiProvider(provider)) {
    return (validation?.status === "valid" || validation?.status === "not-required")
      && localModelReady(input.config, input.runtimeStore, model);
  }
  if (isXaiGrokSubscriptionProvider(provider)) {
    return (validation?.status === "valid" || validation?.status === "not-required")
      && input.config.grokSubscriptionConnected === true;
  }
  if (validation?.status === "valid") return true;
  if (validation?.status !== "not-required") return false;
  return false;
}

function validated(validation: SearchProviderProfile["validation"]): boolean {
  return validation?.status === "valid" || validation?.status === "not-required";
}

function localModelReady(config: AppConfig, runtimeStore: RuntimeStore | undefined, model: string): boolean {
  try {
    resolveLocalInferenceConfig({
      ...config,
      aiProvider: "local",
      aiModel: model,
      localAgentModel: model,
    }, runtimeStore);
    return true;
  } catch {
    return false;
  }
}

async function providerApiKey(
  provider: string,
  config: AppConfig,
  secrets: SecretStore = BunSecretStore,
): Promise<string | undefined> {
  if (!providerRequiresApiKey(provider)) return undefined;
  if (provider === config.aiProvider && config.aiApiKey) return config.aiApiKey;
  return readProviderApiKey(provider, config.botId, secrets);
}

function validationMetadata(validation: ProviderValidationState | undefined): MeshCatalogValidation {
  return {
    status: validation?.status === "not-required" ? "not-required" : "valid",
    validatedAt: validation?.validatedAt ?? null,
    message: validation?.message ?? null,
  };
}

function meshServiceId(provider: string, slot: "primary" | "fast" | "search"): string {
  return `${provider.replace(/[^a-zA-Z0-9._-]+/g, "-")}.${slot}`;
}
