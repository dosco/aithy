import {
  AxAIOpenAIResponsesBase,
  ai,
  axAIOpenAIResponsesDefaultConfig,
  axModelInfoGrok,
  type AxAIService,
} from "@ax-llm/ax";
import type { AppConfig } from "../config/env";
import { fastAiConfigurationIssues } from "../config/validate";
import { GROK_SUBSCRIPTION_API_BASE_URL } from "../grok-subscription/constants";
import {
  markGrokEntitlementDenied,
  resolveGrokSubscriptionCredentials,
} from "../grok-subscription/credentials";
import { isMeshInferenceProvider, MESH_PROXY_AUTH_TOKEN } from "../mesh/types";
import { resolveLocalInferenceConfig } from "../runtime/local-inference-config";
import type { RuntimeStore } from "../runtime/runtime-store";
import {
  XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
  isCustomOpenAIProvider,
  isLocalAiProvider,
  isXaiGrokSubscriptionProvider,
} from "./ai-providers";

export type AiService = Readonly<AxAIService<unknown, unknown, string>>;

export interface AiServiceInput {
  config: AppConfig;
  runtimeStore?: RuntimeStore;
}

export type AiServiceConfigInput = AppConfig | AiServiceInput;

export function createAiService(input: AiServiceConfigInput): AiService {
  const config = resolveAiServiceConfig(input);
  if (isXaiGrokSubscriptionProvider(config.aiProvider)) {
    return createGrokSubscriptionAiService(config, config.aiModel);
  }
  const local = isLocalAiProvider(config.aiProvider);
  const remote = isMeshInferenceProvider(config.aiProvider);
  return ai({
    name: aiServiceProviderName(config.aiProvider),
    ...config.aiProfileArgs,
    apiURL: config.aiApiUrl,
    apiKey: local ? "local" : remote ? MESH_PROXY_AUTH_TOKEN : config.aiApiKey,
    options: requestOptions(config.aiThinkingLevel, config.aiServiceTier),
    config: config.aiModel
      ? local || remote ? { model: config.aiModel, stream: false } : { model: config.aiModel }
      : undefined,
  } as never) as AiService;
}

export function createFastAiService(input: AiServiceConfigInput): AiService | undefined {
  const rawConfig = configFromInput(input);
  if (!rawConfig.fastAiProvider) return undefined;
  if (fastAiConfigurationIssues(rawConfig).length > 0) return undefined;
  const config = resolveFastAiServiceConfig(input);
  const fastProvider = config.fastAiProvider;
  if (!fastProvider) return undefined;
  if (isXaiGrokSubscriptionProvider(fastProvider)) {
    return createGrokSubscriptionAiService(config, config.fastAiModel);
  }
  const apiKey = fastProvider === config.aiProvider
    ? config.fastAiApiKey ?? config.aiApiKey
    : config.fastAiApiKey;
  const local = isLocalAiProvider(fastProvider);
  const remote = isMeshInferenceProvider(fastProvider);
  return ai({
    name: aiServiceProviderName(fastProvider),
    ...config.fastAiProfileArgs,
    apiURL: config.fastAiApiUrl,
    apiKey: local ? "local" : remote ? MESH_PROXY_AUTH_TOKEN : apiKey,
    options: requestOptions(config.fastAiThinkingLevel, config.fastAiServiceTier),
    config: config.fastAiModel
      ? local || remote ? { model: config.fastAiModel, stream: false } : { model: config.fastAiModel }
      : undefined,
  } as never) as AiService;
}

export function resolveAiServiceConfig(input: AiServiceConfigInput): AppConfig {
  const { config, runtimeStore } = normalizeInput(input);
  if (isLocalAiProvider(config.aiProvider) && runtimeStore) {
    return resolveLocalInferenceConfig(config, runtimeStore);
  }
  assertLocalProviderResolved(config.aiProvider, config.aiApiUrl);
  return config;
}

function resolveFastAiServiceConfig(input: AiServiceConfigInput): AppConfig {
  const { config, runtimeStore } = normalizeInput(input);
  if (isLocalAiProvider(config.fastAiProvider) && runtimeStore) {
    return resolveLocalInferenceConfig(config, runtimeStore);
  }
  assertLocalProviderResolved(config.fastAiProvider, config.fastAiApiUrl);
  return config;
}

function aiServiceProviderName(provider: string): string {
  return isCustomOpenAIProvider(provider) || isLocalAiProvider(provider) || isMeshInferenceProvider(provider)
    ? "openai"
    : provider;
}

function requestOptions(
  thinkingTokenBudget: AppConfig["aiThinkingLevel"],
  serviceTier: AppConfig["aiServiceTier"],
): { thinkingTokenBudget?: AppConfig["aiThinkingLevel"]; serviceTier?: AppConfig["aiServiceTier"] } | undefined {
  if (!thinkingTokenBudget && !serviceTier) return undefined;
  return {
    ...(thinkingTokenBudget ? { thinkingTokenBudget } : {}),
    ...(serviceTier ? { serviceTier } : {}),
  };
}

function createGrokSubscriptionAiService(
  config: AppConfig,
  model = XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
): AiService {
  const supportService = ai({
    name: "grok",
    apiKey: "grok-subscription",
    config: { model },
  } as never) as AxAIService<unknown, unknown, string>;
  const service = new AxAIOpenAIResponsesBase({
    apiKey: "grok-subscription",
    apiURL: GROK_SUBSCRIPTION_API_BASE_URL,
    modelInfo: axModelInfoGrok,
    config: {
      ...axAIOpenAIResponsesDefaultConfig(),
      model,
    } as never,
    supportFor: (inputModel: unknown) => supportService.getFeatures(inputModel),
  });
  service.setName("xAI Grok Subscription");
  service.setHeaders(async () => ({
    Authorization: `Bearer ${(
      await resolveGrokSubscriptionCredentials({
        botId: config.botId,
        stateDbPath: config.stateDbPath,
      })
    ).accessToken}`,
  }));

  const originalChat = service.chat.bind(service);
  service.chat = (async (req, options) => {
    try {
      return await originalChat(req, options);
    } catch (error) {
      if (httpStatus(error) === 403) {
        markGrokEntitlementDenied(config.stateDbPath);
        throw new Error(
          "The connected Grok subscription is not authorized for xAI API access. Use the separate xAI API-key provider in Aithy, or upgrade the subscription.",
        );
      }
      if (httpStatus(error) !== 401) throw error;
      await resolveGrokSubscriptionCredentials({
        botId: config.botId,
        stateDbPath: config.stateDbPath,
        forceRefresh: true,
      });
      return originalChat(req, options);
    }
  }) as typeof service.chat;
  return service as AiService;
}

function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "code"]) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  const response = record.response;
  if (response && typeof response === "object") {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function normalizeInput(input: AiServiceConfigInput): AiServiceInput {
  return "config" in input ? input : { config: input };
}

function configFromInput(input: AiServiceConfigInput): AppConfig {
  return normalizeInput(input).config;
}

function assertLocalProviderResolved(provider: string | undefined, apiUrl: string | undefined): void {
  if (isLocalAiProvider(provider) && !apiUrl) {
    throw new Error("Local inference is not ready yet.");
  }
}
