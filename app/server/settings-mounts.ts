import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export async function prepareGlobalMounts(
  input: Array<{ hostPath: string }>,
  workspaceRoot: string,
): Promise<{ mounts: Array<{ hostPath: string }>; skippedPaths: string[] }> {
  const seen = new Set<string>();
  const mounts: Array<{ hostPath: string }> = [];
  const skippedPaths: string[] = [];
  const workspacePaths = await workspaceComparisonPaths(workspaceRoot);
  for (const entry of input) {
    const raw = entry.hostPath.trim();
    if (!raw) continue;
    const expanded = expandHome(raw);
    if (!path.isAbsolute(expanded)) throw new Error(`Mount path must be absolute: ${raw}`);
    const { candidate, missing } = await canonicalMountPath(path.resolve(expanded));
    assertAllowedMountPath(candidate, workspacePaths);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    mounts.push({ hostPath: candidate });
    if (missing) skippedPaths.push(candidate);
  }
  return { mounts, skippedPaths };
}

async function workspaceComparisonPaths(workspaceRoot: string): Promise<string[]> {
  const raw = path.resolve(workspaceRoot);
  try {
    const resolved = await realpath(raw);
    return resolved === raw ? [raw] : [raw, resolved];
  } catch {
    return [raw];
  }
}

async function canonicalMountPath(input: string): Promise<{ candidate: string; missing: boolean }> {
  try {
    const candidate = await realpath(input);
    const info = await stat(candidate);
    if (!info.isDirectory()) throw new Error(`Mount path must be a directory: ${candidate}`);
    return { candidate, missing: false };
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return { candidate: input, missing: true };
  }
}

function assertAllowedMountPath(candidate: string, workspacePaths: readonly string[]): void {
  if (candidate === "/workspace" || candidate === "/cache") throw new Error(`Cannot mount reserved path: ${candidate}`);
  if (workspacePaths.some((workspace) => isInside(workspace, candidate))) {
    throw new Error(`Cannot mount a path inside the workspace root: ${candidate}`);
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}
