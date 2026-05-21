export const LOCAL_AI_PROVIDER = "local";

export interface ManagedLocalModel {
  id: string;
  repoId: string;
  filename: string;
  label: string;
  alias: string;
  role: "chat" | "embedding" | "reranker";
  parametersB?: number;
  dim?: number;
  revision?: string;
}

export const DEFAULT_LOCAL_AGENT_MODEL: ManagedLocalModel = {
  id: "hf:unsloth/Qwen3.5-4B-GGUF:Qwen3.5-4B-Q5_K_M.gguf",
  repoId: "unsloth/Qwen3.5-4B-GGUF",
  filename: "Qwen3.5-4B-Q5_K_M.gguf",
  label: "Qwen3.5 4B Q5_K_M",
  alias: "Qwen3.5-4B",
  role: "chat",
  parametersB: 4,
};

export const DEFAULT_LOCAL_AGENT_MODEL_ID = DEFAULT_LOCAL_AGENT_MODEL.id;

export const MANAGED_LOCAL_CHAT_MODELS: readonly ManagedLocalModel[] = [
  DEFAULT_LOCAL_AGENT_MODEL,
  {
    id: "hf:unsloth/Qwen3.5-9B-GGUF:Qwen3.5-9B-Q5_K_M.gguf",
    repoId: "unsloth/Qwen3.5-9B-GGUF",
    filename: "Qwen3.5-9B-Q5_K_M.gguf",
    label: "Qwen3.5 9B Q5_K_M",
    alias: "Qwen3.5-9B",
    role: "chat",
    parametersB: 9,
  },
];

export const DEFAULT_LOCAL_EMBEDDING_MODEL: ManagedLocalModel = {
  id: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF:Qwen3-Embedding-0.6B-Q8_0.gguf",
  repoId: "Qwen/Qwen3-Embedding-0.6B-GGUF",
  filename: "Qwen3-Embedding-0.6B-Q8_0.gguf",
  label: "Qwen3 Embedding 0.6B Q8_0",
  alias: "Qwen3-Embedding-0.6B",
  role: "embedding",
  dim: 1024,
};

export const DEFAULT_LOCAL_RERANKER_MODEL: ManagedLocalModel = {
  id: "hf:Voodisss/Qwen3-Reranker-0.6B-GGUF-llama_cpp:Qwen3-Reranker-0.6B.Q8_0.gguf",
  repoId: "Voodisss/Qwen3-Reranker-0.6B-GGUF-llama_cpp",
  filename: "Qwen3-Reranker-0.6B.Q8_0.gguf",
  label: "Qwen3 Reranker 0.6B Q8_0",
  alias: "Qwen3-Reranker-0.6B",
  role: "reranker",
};

export const REQUIRED_LOCAL_MODELS = [
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_RERANKER_MODEL,
] as const;

export const MANAGED_LOCAL_MODELS: readonly ManagedLocalModel[] = [
  ...MANAGED_LOCAL_CHAT_MODELS,
  ...REQUIRED_LOCAL_MODELS,
];

export const LOCAL_CHAT_MODEL_ALIAS = "aithy-local-chat";
export const LOCAL_EMBEDDING_MODEL_ALIAS = DEFAULT_LOCAL_EMBEDDING_MODEL.alias;
export const LOCAL_RERANKER_MODEL_ALIAS = DEFAULT_LOCAL_RERANKER_MODEL.alias;
export const LOCAL_EMBEDDING_DIM = DEFAULT_LOCAL_EMBEDDING_MODEL.dim ?? 1024;

export const CURRENT_EMBEDDING_MODEL_ID = DEFAULT_LOCAL_EMBEDDING_MODEL.id;
export const CURRENT_RANKING_MODEL_ID = DEFAULT_LOCAL_RERANKER_MODEL.id;

export function isLocalAiProvider(provider: string | undefined | null): boolean {
  return provider === LOCAL_AI_PROVIDER;
}

export function localModelId(repoId: string, filename: string): string {
  return `hf:${repoId}:${filename}`;
}

export function parseLocalModelId(value: string | undefined | null):
  | { repoId: string; filename: string }
  | null {
  if (!value?.startsWith("hf:")) return null;
  const rest = value.slice(3);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) return null;
  return {
    repoId: rest.slice(0, separator),
    filename: rest.slice(separator + 1),
  };
}

export function selectedLocalAgentModelId(value: string | undefined | null): string {
  if (!parseLocalModelId(value)?.filename) return DEFAULT_LOCAL_AGENT_MODEL_ID;
  if (REQUIRED_LOCAL_MODELS.some((model) => model.id === value)) return DEFAULT_LOCAL_AGENT_MODEL_ID;
  return value!;
}
