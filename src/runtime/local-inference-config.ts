import type { AppConfig } from "../config/env";
import { LOCAL_CHAT_MODEL_ALIAS, isLocalAiProvider } from "../local-inference/manifest";
import { localChatReady, localInferenceDetail } from "../local-inference/status";
import type { RuntimeStore } from "./runtime-store";

export function resolveLocalInferenceConfig(
  config: AppConfig,
  store: RuntimeStore | undefined,
): AppConfig {
  if (!isLocalAiProvider(config.aiProvider) && !isLocalAiProvider(config.fastAiProvider)) {
    return config;
  }
  const service = store?.service("local-inference-worker");
  const detail = localInferenceDetail(service);
  if (!detail?.baseUrl || !localChatReady(service, config)) {
    throw new Error(detail?.error ?? "Local inference is not ready yet.");
  }
  const apiUrl = `${detail.baseUrl}/v1`;
  const chatModel = detail.chatAlias ?? LOCAL_CHAT_MODEL_ALIAS;
  return {
    ...config,
    aiApiUrl: isLocalAiProvider(config.aiProvider) ? apiUrl : config.aiApiUrl,
    aiApiKey: isLocalAiProvider(config.aiProvider) ? "local" : config.aiApiKey,
    aiModel: isLocalAiProvider(config.aiProvider) ? chatModel : config.aiModel,
    fastAiApiUrl: isLocalAiProvider(config.fastAiProvider) ? apiUrl : config.fastAiApiUrl,
    fastAiApiKey: isLocalAiProvider(config.fastAiProvider) ? "local" : config.fastAiApiKey,
    fastAiModel: isLocalAiProvider(config.fastAiProvider) ? chatModel : config.fastAiModel,
  };
}
