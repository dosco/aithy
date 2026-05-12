export type SetupStatusTone = "neutral" | "danger" | "success";

export interface SetupStatusInput {
  key: string;
  label: string;
  active: boolean;
  tone?: SetupStatusTone;
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
}

export interface TransformerProgressEvent {
  status?: string;
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  model?: string;
}

export interface PullProgressEventLike {
  kind: string;
  reference?: string;
  layerCount?: number;
  totalDownloadBytes?: number;
  layerIndex?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesRead?: number;
}

export function transformerProgressStatus(
  key: string,
  displayName: string,
  modelId: string,
  event: TransformerProgressEvent,
): SetupStatusInput | null {
  if (event.status === "ready") {
    return readyStatus(key, `${displayName} ready`);
  }
  if (event.status === "initiate") {
    return activeStatus(key, `locating ${displayName} ${modelId}`);
  }
  if (event.status === "download") {
    return activeStatus(key, `downloading ${displayName} ${modelId}`);
  }
  if (event.status === "progress") {
    return activeStatus(key, `downloading ${displayName} ${modelId}`, {
      progress: numericProgress(event.progress, event.loaded, event.total),
      loadedBytes: event.loaded,
      totalBytes: event.total,
    });
  }
  if (event.status === "done") {
    return activeStatus(key, `loading ${displayName} ${modelId}`, { progress: 1 });
  }
  return null;
}

export function createPullProgressTracker(image: string) {
  const layers = new Map<number, { downloaded: number; total: number }>();
  let totalDownloadBytes: number | undefined;

  return (event: PullProgressEventLike): SetupStatusInput => {
    if (event.totalDownloadBytes) totalDownloadBytes = event.totalDownloadBytes;
    if (event.layerIndex !== undefined) updateLayer(layers, event);
    const bytes = aggregateLayerBytes(layers, totalDownloadBytes);

    if (event.kind === "resolving") {
      return activeStatus("sandbox", `resolving sandbox image ${image}`);
    }
    if (event.kind === "resolved") {
      return activeStatus("sandbox", `resolved sandbox image ${image}`);
    }
    if (event.kind.startsWith("layerDownload")) {
      return activeStatus("sandbox", `downloading sandbox image ${image}`, bytes);
    }
    if (event.kind.startsWith("layerMaterialize") || event.kind.startsWith("stitch")) {
      return activeStatus("sandbox", "preparing sandbox filesystem", bytes);
    }
    if (event.kind === "complete") return readyStatus("sandbox", "sandbox image ready");
    return activeStatus("sandbox", `starting sandbox image ${image}`, bytes);
  };
}

export function activeStatus(
  key: string,
  label: string,
  extra: Partial<SetupStatusInput> = {},
): SetupStatusInput {
  return { key, label, active: true, tone: "neutral", ...clamped(extra) };
}

export function readyStatus(key: string, label: string): SetupStatusInput {
  return { key, label, active: false, tone: "success", progress: 1 };
}

export function failedStatus(key: string, label: string): SetupStatusInput {
  return { key, label, active: false, tone: "danger" };
}

function numericProgress(
  progress: number | undefined,
  loaded: number | undefined,
  total: number | undefined,
): number | undefined {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return clamp(progress > 1 ? progress / 100 : progress);
  }
  if (loaded && total) return clamp(loaded / total);
  return undefined;
}

function updateLayer(
  layers: Map<number, { downloaded: number; total: number }>,
  event: PullProgressEventLike,
): void {
  const layer = layers.get(event.layerIndex!) ?? { downloaded: 0, total: 0 };
  layer.downloaded = Math.max(layer.downloaded, event.downloadedBytes ?? event.bytesRead ?? 0);
  layer.total = Math.max(layer.total, event.totalBytes ?? layer.downloaded);
  layers.set(event.layerIndex!, layer);
}

function aggregateLayerBytes(
  layers: Map<number, { downloaded: number; total: number }>,
  totalDownloadBytes: number | undefined,
): Pick<SetupStatusInput, "progress" | "loadedBytes" | "totalBytes"> {
  const loadedBytes = [...layers.values()].reduce((sum, layer) => sum + layer.downloaded, 0);
  const knownTotal = [...layers.values()].reduce((sum, layer) => sum + layer.total, 0);
  const totalBytes = totalDownloadBytes ?? (knownTotal > 0 ? knownTotal : undefined);
  return {
    loadedBytes: loadedBytes || undefined,
    totalBytes,
    progress: numericProgress(undefined, loadedBytes, totalBytes),
  };
}

function clamped(extra: Partial<SetupStatusInput>): Partial<SetupStatusInput> {
  if (extra.progress === undefined) return extra;
  return { ...extra, progress: clamp(extra.progress) };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
