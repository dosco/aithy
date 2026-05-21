export const LOCAL_INFERENCE_CONTEXT_SIZE_OPTIONS = [
  8192,
  32768,
  65536,
  131072,
  262144,
] as const;

export const LOCAL_INFERENCE_KV_CACHE_TYPES = ["f16", "q8_0"] as const;

export type LocalInferenceKvCacheType = typeof LOCAL_INFERENCE_KV_CACHE_TYPES[number];

export interface LocalInferenceSettings {
  llamaServerPath: string;
  contextSize: number;
  embeddingContextSize: number;
  rerankerContextSize: number;
  gpuLayers: number;
  flashAttention: boolean;
  batchSize: number;
  ubatchSize: number;
  modelsMax: number;
  kvCacheType: LocalInferenceKvCacheType;
  thinkingMode: boolean;
  maxOutputTokens: number;
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
  repeatPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
}

export const defaultLocalInferenceSettings: LocalInferenceSettings = {
  llamaServerPath: "",
  contextSize: 32768,
  embeddingContextSize: 8192,
  rerankerContextSize: 8192,
  gpuLayers: 99,
  flashAttention: true,
  batchSize: 2048,
  ubatchSize: 2048,
  modelsMax: 3,
  kvCacheType: "f16",
  thinkingMode: true,
  maxOutputTokens: 32768,
  temperature: 0.6,
  topK: 20,
  topP: 0.95,
  minP: 0,
  repeatPenalty: 1,
  presencePenalty: 0,
  frequencyPenalty: 0,
};

export function normalizeLocalInferenceSettings(
  input: Partial<LocalInferenceSettings> | null | undefined,
): LocalInferenceSettings {
  const legacyKvCacheType = typeof input?.kvCacheType === "string"
    ? input.kvCacheType.toLowerCase()
    : undefined;
  return {
    llamaServerPath: typeof input?.llamaServerPath === "string" ? input.llamaServerPath.trim() : "",
    contextSize: integerInRange(input?.contextSize, 4096, 262144, defaultLocalInferenceSettings.contextSize),
    embeddingContextSize: integerInRange(
      input?.embeddingContextSize,
      1024,
      32768,
      defaultLocalInferenceSettings.embeddingContextSize,
    ),
    rerankerContextSize: integerInRange(
      input?.rerankerContextSize,
      1024,
      40960,
      defaultLocalInferenceSettings.rerankerContextSize,
    ),
    gpuLayers: integerInRange(input?.gpuLayers, 0, 999, defaultLocalInferenceSettings.gpuLayers),
    flashAttention: typeof input?.flashAttention === "boolean"
      ? input.flashAttention
      : defaultLocalInferenceSettings.flashAttention,
    batchSize: integerInRange(input?.batchSize, 1, 8192, defaultLocalInferenceSettings.batchSize),
    ubatchSize: integerInRange(input?.ubatchSize, 1, 8192, defaultLocalInferenceSettings.ubatchSize),
    modelsMax: integerInRange(input?.modelsMax, 1, 16, defaultLocalInferenceSettings.modelsMax),
    kvCacheType: oneOf(legacyKvCacheType, LOCAL_INFERENCE_KV_CACHE_TYPES, defaultLocalInferenceSettings.kvCacheType),
    thinkingMode: typeof input?.thinkingMode === "boolean"
      ? input.thinkingMode
      : defaultLocalInferenceSettings.thinkingMode,
    maxOutputTokens: integerInRange(
      input?.maxOutputTokens,
      1,
      81920,
      defaultLocalInferenceSettings.maxOutputTokens,
    ),
    temperature: numberInRange(input?.temperature, 0, 2, defaultLocalInferenceSettings.temperature),
    topK: integerInRange(input?.topK, 1, 100, defaultLocalInferenceSettings.topK),
    topP: numberInRange(input?.topP, 0, 1, defaultLocalInferenceSettings.topP),
    minP: numberInRange(input?.minP, 0, 1, defaultLocalInferenceSettings.minP),
    repeatPenalty: numberInRange(input?.repeatPenalty, 0, 3, defaultLocalInferenceSettings.repeatPenalty),
    presencePenalty: numberInRange(input?.presencePenalty, 0, 3, defaultLocalInferenceSettings.presencePenalty),
    frequencyPenalty: numberInRange(input?.frequencyPenalty, 0, 3, defaultLocalInferenceSettings.frequencyPenalty),
  };
}

function integerInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function numberInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  options: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? value as T[number]
    : fallback;
}
