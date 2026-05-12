import {
  AxAIAnthropicModel,
  AxAICohereModel,
  AxAIDeepSeekModel,
  AxAIGoogleGeminiModel,
  AxAIGrokModel,
  AxAIGroqModel,
  AxAIHuggingFaceModel,
  AxAIMistralModel,
  AxAIOpenAIModel,
  AxAIOpenAIResponsesModel,
  AxAIRekaModel,
  AxAITogetherModel,
  AxAIWebLLMModel,
} from "@ax-llm/ax";

export const AX_AI_PROVIDERS = [
  "openai",
  "openai-responses",
  "azure-openai",
  "anthropic",
  "google-gemini",
  "groq",
  "mistral",
  "deepseek",
  "ollama",
  "cohere",
  "together",
  "openrouter",
  "huggingface",
  "reka",
  "grok",
  "webllm",
] as const;

export type AxAiProviderName = (typeof AX_AI_PROVIDERS)[number];

export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

export function isAxAiProvider(value: string): value is AxAiProviderName {
  return (AX_AI_PROVIDERS as readonly string[]).includes(value);
}

function enumValues(e: object): string[] {
  return Object.values(e).filter((v): v is string => typeof v === "string");
}

export const AX_AI_PROVIDER_MODELS: Record<string, readonly string[]> = {
  openai: withPreferredModel(DEFAULT_OPENAI_MODEL, enumValues(AxAIOpenAIModel)),
  "openai-responses": enumValues(AxAIOpenAIResponsesModel),
  "azure-openai": enumValues(AxAIOpenAIModel),
  anthropic: enumValues(AxAIAnthropicModel),
  "google-gemini": enumValues(AxAIGoogleGeminiModel),
  groq: enumValues(AxAIGroqModel),
  mistral: enumValues(AxAIMistralModel),
  deepseek: enumValues(AxAIDeepSeekModel),
  ollama: [],
  cohere: enumValues(AxAICohereModel),
  together: enumValues(AxAITogetherModel),
  openrouter: [],
  huggingface: enumValues(AxAIHuggingFaceModel),
  reka: enumValues(AxAIRekaModel),
  grok: enumValues(AxAIGrokModel),
  webllm: enumValues(AxAIWebLLMModel),
};

export function modelsForProvider(provider: string): readonly string[] {
  return AX_AI_PROVIDER_MODELS[provider] ?? [];
}

export function defaultModelForProvider(provider: string): string {
  return provider === "openai" ? DEFAULT_OPENAI_MODEL : "";
}

function withPreferredModel(model: string, models: readonly string[]): readonly string[] {
  return models.includes(model) ? models : [model, ...models];
}
