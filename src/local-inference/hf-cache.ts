import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  MANAGED_LOCAL_MODELS,
  localModelId,
  parseLocalModelId,
  type ManagedLocalModel,
} from "./manifest";

export interface LocalGgufModel {
  id: string;
  repoId: string;
  filename: string;
  path: string;
  displayName: string;
  sizeBytes: number;
  managed: boolean;
}

export function resolveHfHubCacheDir(
  home = homedir(),
): string {
  return path.join(home, ".cache", "huggingface", "hub");
}

export function hfRepoFolderName(repoId: string): string {
  return `models--${repoId.replaceAll("/", "--")}`;
}

export function repoIdFromHfFolderName(folderName: string): string | null {
  if (!folderName.startsWith("models--")) return null;
  const name = folderName.slice("models--".length);
  return name ? name.replaceAll("--", "/") : null;
}

export async function listCachedGgufModels(
  cacheDir = resolveHfHubCacheDir(),
): Promise<LocalGgufModel[]> {
  const results: LocalGgufModel[] = [];
  for (const repoFolder of await safeReaddir(cacheDir)) {
    const repoId = repoIdFromHfFolderName(repoFolder.name);
    if (!repoId || !repoFolder.isDirectory()) continue;
    const snapshotsDir = path.join(cacheDir, repoFolder.name, "snapshots");
    for (const snapshot of await safeReaddir(snapshotsDir)) {
      if (!snapshot.isDirectory()) continue;
      const root = path.join(snapshotsDir, snapshot.name);
      for (const file of await findGgufFiles(root)) {
        const filename = path.relative(root, file);
        const info = await stat(file);
        results.push({
          id: localModelId(repoId, filename),
          repoId,
          filename,
          path: file,
          displayName: displayModelName(repoId, filename),
          sizeBytes: info.size,
          managed: isManagedLocalModel(repoId, filename),
        });
      }
    }
  }
  return dedupeModels(results).sort((a, b) =>
    Number(b.managed) - Number(a.managed)
    || a.displayName.localeCompare(b.displayName)
  );
}

export async function resolveCachedLocalModelPath(
  id: string,
  cacheDir = resolveHfHubCacheDir(),
): Promise<string | null> {
  const parsed = parseLocalModelId(id);
  if (!parsed) return null;
  const repoRoot = path.join(cacheDir, hfRepoFolderName(parsed.repoId), "snapshots");
  for (const snapshot of await safeReaddir(repoRoot)) {
    if (!snapshot.isDirectory()) continue;
    const candidate = path.join(repoRoot, snapshot.name, parsed.filename);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {}
  }
  return null;
}

export function managedLocalModelById(id: string): ManagedLocalModel | null {
  return MANAGED_LOCAL_MODELS.find((model) => model.id === id) ?? null;
}

export function displayModelName(repoId: string, filename: string): string {
  return `${repoId} / ${path.basename(filename)}`;
}

async function findGgufFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await safeReaddir(dir)) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findGgufFiles(fullPath));
    else if (isGgufEntry(entry.name) && await isReadableFile(fullPath)) files.push(fullPath);
  }
  return files;
}

async function isReadableFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function isGgufEntry(name: string): boolean {
  return name.toLowerCase().endsWith(".gguf");
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function dedupeModels(models: LocalGgufModel[]): LocalGgufModel[] {
  const seen = new Map<string, LocalGgufModel>();
  for (const model of models) {
    const existing = seen.get(model.id);
    if (!existing || model.managed) seen.set(model.id, model);
  }
  return [...seen.values()];
}

function isManagedLocalModel(repoId: string, filename: string): boolean {
  return MANAGED_LOCAL_MODELS.some((model) =>
    repoId === model.repoId && filename === model.filename
  );
}
