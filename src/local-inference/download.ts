import { downloadFileToCacheDir } from "@huggingface/hub";
import { activeStatus, failedStatus, readyStatus, type SetupStatusInput } from "../setup/status";
import { managedLocalModelById, resolveCachedLocalModelPath, resolveHfHubCacheDir } from "./hf-cache";
import { DEFAULT_LOCAL_AGENT_MODEL, REQUIRED_LOCAL_MODELS, type ManagedLocalModel } from "./manifest";

export async function ensureLocalAgentModel(
  modelId: string,
  input: {
    cacheDir?: string;
    onStatus?: (status: SetupStatusInput) => void;
  } = {},
): Promise<string> {
  const cached = await resolveCachedLocalModelPath(modelId, input.cacheDir);
  if (cached) return cached;
  const model = managedLocalModelById(modelId);
  if (!model) throw new Error(`Local model is not cached: ${modelId}`);
  return downloadManagedModel(model, input);
}

export async function ensureDefaultLocalAgentModel(input: {
  cacheDir?: string;
  onStatus?: (status: SetupStatusInput) => void;
} = {}): Promise<string> {
  return ensureLocalAgentModel(DEFAULT_LOCAL_AGENT_MODEL.id, input);
}

export async function ensureRequiredLocalModels(input: {
  includeChat?: boolean;
  chatModelId?: string;
  cacheDir?: string;
  onStatus?: (status: SetupStatusInput) => void;
} = {}): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  if (input.includeChat) {
    const chatModelId = input.chatModelId ?? DEFAULT_LOCAL_AGENT_MODEL.id;
    paths.set("chat", await ensureLocalAgentModel(chatModelId, input));
  }
  for (const model of REQUIRED_LOCAL_MODELS) {
    if (model.role === "chat") continue;
    const path = await ensureLocalAgentModel(model.id, input);
    paths.set(model.role, path);
  }
  return paths;
}

async function downloadManagedModel(
  model: ManagedLocalModel,
  input: {
    cacheDir?: string;
    onStatus?: (status: SetupStatusInput) => void;
  },
): Promise<string> {
  const cacheDir = input.cacheDir ?? resolveHfHubCacheDir();
  const statusKey = `local.${model.role}.download`;
  const report = input.onStatus ?? (() => {});
  report(activeStatus(statusKey, `locating local model ${model.label}`));
  try {
    const pointer = await downloadFileToCacheDir({
      repo: { type: "model", name: model.repoId },
      path: model.filename,
      revision: model.revision ?? "main",
      cacheDir,
      fetch: progressFetch(model, report, statusKey),
    });
    report(readyStatus(statusKey, `local model ready ${model.label}`));
    return pointer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report(failedStatus(statusKey, `local model failed: ${message}`));
    throw error;
  }
}

export function progressFetch(
  model: ManagedLocalModel,
  report: (status: SetupStatusInput) => void,
  key: string,
): typeof fetch {
  let loadedBytes = 0;
  let totalBytes: number | undefined;
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await fetch(input, init);
    if (response.ok) {
      totalBytes = stableFileSize(response.headers, input, init) ?? totalBytes;
    }
    if (!response.ok || !response.body || init?.method === "HEAD") return response;
    const contentLength = numericHeader(response.headers.get("content-length"));
    if (!contentLength || contentLength < 1024 * 1024) return response;
    const requestRange = requestHeaderValue(input, init, "range");
    if (!totalBytes && !requestRange) totalBytes = contentLength;
    report(activeStatus(key, `downloading local model ${model.label}`, {
      loadedBytes,
      totalBytes,
      progress: totalBytes ? loadedBytes / totalBytes : undefined,
    }));
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }
        loadedBytes += chunk.value.byteLength;
        report(activeStatus(key, `downloading local model ${model.label}`, {
          loadedBytes,
          totalBytes,
          progress: totalBytes ? loadedBytes / totalBytes : undefined,
        }));
        controller.enqueue(chunk.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  return wrapped as typeof fetch;
}

function numericHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function stableFileSize(
  headers: Headers,
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): number | undefined {
  const linkedSize = numericHeader(headers.get("x-linked-size"));
  if (linkedSize) return linkedSize;
  const range = requestHeaderValue(input, init, "range");
  if (range !== "bytes=0-0") return undefined;
  const contentRange = headers.get("content-range");
  const total = contentRange?.match(/\/(\d+)$/)?.[1];
  return numericHeader(total ?? null);
}

function requestHeaderValue(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] | undefined,
  name: string,
): string | undefined {
  return headerValue(init?.headers, name)
    ?? (input instanceof Request ? input.headers.get(name)?.toLowerCase() : undefined);
}

function headerValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name)?.toLowerCase();
  const lowerName = name.toLowerCase();
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === lowerName);
    return pair?.[1].toLowerCase();
  }
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName)?.[1];
  return value?.toLowerCase();
}
