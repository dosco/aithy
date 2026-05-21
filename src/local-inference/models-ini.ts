import {
  LOCAL_CHAT_MODEL_ALIAS,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_RERANKER_MODEL,
} from "./manifest";
import type { LocalInferenceSettings } from "./settings";

export interface LocalModelPaths {
  chat?: string;
  embedding: string;
  reranker: string;
}

export function renderLlamaModelsIni(
  settings: LocalInferenceSettings,
  paths: LocalModelPaths,
): string {
  const lines = [
    "version = 1",
    "",
    "[*]",
    `n-gpu-layers = ${settings.gpuLayers}`,
    `flash-attn = ${settings.flashAttention ? "true" : "false"}`,
    "ctx-size = 8192",
    `batch-size = ${settings.batchSize}`,
    `ubatch-size = ${settings.ubatchSize}`,
    `cache-type-k = ${settings.kvCacheType}`,
    `cache-type-v = ${settings.kvCacheType}`,
    "",
  ];
  if (paths.chat) {
    lines.push(
      `[${LOCAL_CHAT_MODEL_ALIAS}]`,
      `model = ${paths.chat}`,
      `ctx-size = ${settings.contextSize}`,
      "jinja = true",
      `chat-template-kwargs = ${JSON.stringify({ enable_thinking: settings.thinkingMode })}`,
      "load-on-startup = true",
      "",
    );
  }
  lines.push(
    `[${DEFAULT_LOCAL_EMBEDDING_MODEL.alias}]`,
    `model = ${paths.embedding}`,
    "embedding = true",
    "pooling = last",
    `ctx-size = ${settings.embeddingContextSize}`,
    "load-on-startup = true",
    "",
    `[${DEFAULT_LOCAL_RERANKER_MODEL.alias}]`,
    `model = ${paths.reranker}`,
    "embedding = true",
    "reranking = true",
    "pooling = rank",
    `ctx-size = ${settings.rerankerContextSize}`,
    "load-on-startup = true",
    "",
  );
  return lines.join("\n");
}
