import type { LocalInferenceSettings } from "../../../local-inference/settings";
import type { LlamaRouterProcess } from "../../../local-inference/router";

export function localInferenceLoadSettingsKey(settings: LocalInferenceSettings, modelId: string | null): string {
  return JSON.stringify({
    chatModelId: modelId,
    llamaServerPath: settings.llamaServerPath,
    contextSize: settings.contextSize,
    embeddingContextSize: settings.embeddingContextSize,
    rerankerContextSize: settings.rerankerContextSize,
    gpuLayers: settings.gpuLayers,
    flashAttention: settings.flashAttention,
    batchSize: settings.batchSize,
    ubatchSize: settings.ubatchSize,
    modelsMax: settings.modelsMax,
    kvCacheType: settings.kvCacheType,
    thinkingMode: settings.thinkingMode,
  });
}

export function requiredPath(paths: Map<string, string>, role: string): string {
  const value = paths.get(role);
  if (!value) throw new Error(`missing local model path for ${role}`);
  return value;
}

export function routerPid(router: LlamaRouterProcess): number | undefined {
  const pid = (router.proc as { pid?: unknown }).pid;
  return typeof pid === "number" ? pid : undefined;
}

export function objectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new Error("Invalid local inference command payload");
  return payload as Record<string, unknown>;
}

export function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Invalid local inference command field: ${key}`);
  return field;
}

export function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) {
    throw new Error(`Invalid local inference command field: ${key}`);
  }
  return field;
}

export function optionalStringArray(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (field === undefined) return [];
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) {
    throw new Error(`Invalid local inference command field: ${key}`);
  }
  return [...new Set(field.map((item) => item.trim()).filter(Boolean))];
}
