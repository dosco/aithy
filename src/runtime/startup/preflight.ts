import { ensureRequiredLocalModels as defaultEnsureRequiredLocalModels } from "../../local-inference/download";
import type { SetupStatusInput } from "../../setup/status";

type EnsureRequiredLocalModels = typeof defaultEnsureRequiredLocalModels;

export interface StartupLocalModelsOptions {
  ensureRequiredLocalModels?: EnsureRequiredLocalModels;
  log?: (message: string) => void;
}

export async function ensureStartupLocalModels(
  options: StartupLocalModelsOptions = {},
): Promise<Map<string, string>> {
  const ensureRequiredLocalModels = options.ensureRequiredLocalModels ?? defaultEnsureRequiredLocalModels;
  const log = options.log ?? ((message) => console.log(message));
  log("[startup] checking default local inference models");
  try {
    const modelPaths = await ensureRequiredLocalModels({
      includeChat: false,
      onStatus: (status) => log(startupStatusMessage(status)),
    });
    log("[startup] default local inference models ready");
    return modelPaths;
  } catch (error) {
    log(`[startup] default local inference models failed: ${errorMessage(error)}`);
    throw error;
  }
}

function startupStatusMessage(status: SetupStatusInput): string {
  const prefix = status.tone === "danger"
    ? "[startup:error]"
    : status.tone === "success"
      ? "[startup:ready]"
      : "[startup]";
  const progress = typeof status.progress === "number"
    ? ` ${Math.round(status.progress * 100)}%`
    : "";
  const bytes = status.loadedBytes !== undefined || status.totalBytes !== undefined
    ? ` (${formatBytes(status.loadedBytes ?? 0)} / ${formatBytes(status.totalBytes ?? 0)})`
    : "";
  return `${prefix} ${status.label}${progress}${bytes}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
