import type { AppConfig } from "../config/env";
import type { EmbeddingHealthStats } from "../retrieval/indexing";
import type { RuntimeServiceStatus } from "../runtime/protocol/types";
import { isLocalAiProvider, selectedLocalAgentModelId } from "./manifest";

export interface LocalInferenceServiceDetail {
  required: boolean;
  ready: boolean;
  routerRequired?: boolean;
  chatRequired?: boolean;
  chatReady?: boolean;
  modelId?: string;
  modelPath?: string;
  chatAlias?: string;
  embeddingAlias?: string;
  rerankerAlias?: string;
  embeddingDim?: number;
  baseUrl?: string;
  cacheDir?: string;
  binaryPath?: string;
  binarySource?: string;
  modelsIniPath?: string;
  error?: string;
  downloading?: boolean;
  embeddingHealth?: LocalEmbeddingHealth;
}

export interface LocalEmbeddingHealth {
  memories: EmbeddingHealthStats;
  episodes: EmbeddingHealthStats;
  skills: EmbeddingHealthStats;
  lastTargetedIndexAt: string | null;
  lastBackfillAt: string | null;
  lastIndexError: string | null;
  rerankerReady: boolean;
}

export function localInferenceRequired(_config: AppConfig): boolean {
  return true;
}

export function localChatRequired(config: AppConfig): boolean {
  return isLocalAiProvider(config.aiProvider) || isLocalAiProvider(config.fastAiProvider);
}

export function localInferenceDetail(
  service: RuntimeServiceStatus | null | undefined,
): LocalInferenceServiceDetail | null {
  if (!service?.detail || typeof service.detail !== "object") return null;
  const detail = service.detail as Record<string, unknown>;
  return {
    required: detail.required === true,
    ready: detail.ready === true,
    routerRequired: detail.routerRequired === true,
    chatRequired: detail.chatRequired === true,
    chatReady: detail.chatReady === true,
    modelId: stringValue(detail.modelId),
    modelPath: stringValue(detail.modelPath),
    chatAlias: stringValue(detail.chatAlias),
    embeddingAlias: stringValue(detail.embeddingAlias),
    rerankerAlias: stringValue(detail.rerankerAlias),
    embeddingDim: numberValue(detail.embeddingDim),
    baseUrl: stringValue(detail.baseUrl),
    cacheDir: stringValue(detail.cacheDir),
    binaryPath: stringValue(detail.binaryPath),
    binarySource: stringValue(detail.binarySource),
    modelsIniPath: stringValue(detail.modelsIniPath),
    error: stringValue(detail.error),
    downloading: detail.downloading === true,
    embeddingHealth: embeddingHealth(detail.embeddingHealth),
  };
}

export function localInferenceReady(service: RuntimeServiceStatus | null | undefined): boolean {
  const detail = localInferenceDetail(service);
  return service?.state === "ready" && detail?.ready === true && Boolean(detail.baseUrl);
}

export function localChatReady(
  service: RuntimeServiceStatus | null | undefined,
  config: AppConfig,
): boolean {
  const detail = localInferenceDetail(service);
  if (!localChatRequired(config)) return true;
  const modelId = selectedLocalAgentModelId(config.localAgentModel ?? config.aiModel);
  return localInferenceReady(service)
    && detail?.chatReady === true
    && detail.modelId === modelId;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function embeddingHealth(value: unknown): LocalEmbeddingHealth | undefined {
  if (!value || typeof value !== "object") return undefined;
  const detail = value as Record<string, unknown>;
  const memories = embeddingStats(detail.memories);
  const episodes = embeddingStats(detail.episodes);
  const skills = embeddingStats(detail.skills);
  if (!memories || !episodes || !skills) return undefined;
  return {
    memories,
    episodes,
    skills,
    lastTargetedIndexAt: stringOrNull(detail.lastTargetedIndexAt),
    lastBackfillAt: stringOrNull(detail.lastBackfillAt),
    lastIndexError: stringOrNull(detail.lastIndexError),
    rerankerReady: detail.rerankerReady === true,
  };
}

function embeddingStats(value: unknown): EmbeddingHealthStats | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const total = numberValue(record.total);
  const embedded = numberValue(record.embedded);
  const stale = numberValue(record.stale);
  return total === undefined || embedded === undefined || stale === undefined
    ? undefined
    : { total, embedded, stale };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
