import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ensureRelativePath, safeJoin } from "../workspace/safe-path";

export const OUTBOX_SANDBOX_ROOT = "/outbox";
export const LEGACY_WORKSPACE_OUTBOX_ROOT = "/workspace/outbox";

export interface OutboxPath {
  sandboxPath: string;
  relativePath: string;
}

export interface ResolvedArtifactFile {
  hostPath: string;
  sizeBytes: number;
}

export function runOutboxPath(sessionId: string, runId: string): string {
  return `${OUTBOX_SANDBOX_ROOT}/${safeSegment(sessionId)}/${safeSegment(runId)}`;
}

export function normalizeRunOutboxPath(input: string, currentRunOutbox: string): OutboxPath {
  const runRoot = normalizeRunRoot(currentRunOutbox);
  const trimmed = input.replaceAll("\\", "/").trim();
  if (!trimmed) throw new Error(`Artifacts must be under ${runRoot}`);
  if (trimmed.startsWith(`${runRoot}/`)) return outboxPathForRunRelative(runRoot, trimmed.slice(runRoot.length + 1));
  if (trimmed === runRoot) throw new Error("Artifact path must include a filename");
  if (trimmed.startsWith(`${OUTBOX_SANDBOX_ROOT}/`)) {
    throw new Error(`Artifacts must be under the current run outbox: ${runRoot}`);
  }
  if (trimmed.startsWith(`${LEGACY_WORKSPACE_OUTBOX_ROOT}/`) || trimmed.startsWith("/workspace/")) {
    throw new Error(`New artifacts must be written under ${runRoot}`);
  }
  if (trimmed.startsWith("/")) throw new Error(`Artifacts must be under ${runRoot}`);
  return outboxPathForRunRelative(runRoot, trimmed);
}

export async function resolveRunOutboxWriteTarget(
  outboxRoot: string,
  outboxRelativePath: string,
): Promise<{ hostPath: string }> {
  const hostPath = await prepareRunOutboxTarget(outboxRoot, outboxRelativePath);
  try {
    const info = await lstat(hostPath);
    if (info.isSymbolicLink()) throw new Error("Artifact path must not be a symlink");
    if (info.isDirectory()) throw new Error("Artifact path must not be a directory");
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
  return { hostPath };
}

export async function resolveOutboxFile(
  workspaceRoot: string,
  outboxRoot: string,
  sandboxPath: string,
  relativePath: string,
): Promise<ResolvedArtifactFile> {
  const hostPath = sandboxPath.startsWith(`${LEGACY_WORKSPACE_OUTBOX_ROOT}/`)
    ? safeJoin(path.join(workspaceRoot, "outbox"), relativePath)
    : safeJoin(outboxRoot, relativePath);
  const info = await lstat(hostPath);
  if (info.isSymbolicLink()) throw new Error("Artifact path must not be a symlink");
  if (!info.isFile()) throw new Error("Artifact path must be a regular file");

  const root = sandboxPath.startsWith(`${LEGACY_WORKSPACE_OUTBOX_ROOT}/`)
    ? path.join(workspaceRoot, "outbox")
    : outboxRoot;
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(hostPath)]);
  assertInside(realRoot, realFile);
  const current = await stat(realFile);
  if (!current.isFile()) throw new Error("Artifact path must be a regular file");
  return { hostPath: realFile, sizeBytes: current.size };
}

export function relativePathForRunFile(currentRunOutbox: string, fileRelativePath: string): OutboxPath {
  return outboxPathForRunRelative(normalizeRunRoot(currentRunOutbox), fileRelativePath);
}

function outboxPathForRunRelative(runRoot: string, input: string): OutboxPath {
  const fileRelativePath = ensureRelativePath(input);
  const outboxRelativeRoot = ensureRelativePath(runRoot.slice(OUTBOX_SANDBOX_ROOT.length + 1));
  const relativePath = `${outboxRelativeRoot}/${fileRelativePath}`;
  return {
    relativePath,
    sandboxPath: `${runRoot}/${fileRelativePath}`,
  };
}

function normalizeRunRoot(input: string): string {
  const root = input.replaceAll("\\", "/").replace(/\/+$/g, "");
  if (!root.startsWith(`${OUTBOX_SANDBOX_ROOT}/`)) {
    throw new Error(`Run outbox must be under ${OUTBOX_SANDBOX_ROOT}`);
  }
  return root;
}

async function prepareRunOutboxTarget(outboxRoot: string, outboxRelativePath: string): Promise<string> {
  await mkdir(outboxRoot, { recursive: true });
  const hostPath = safeJoin(outboxRoot, outboxRelativePath);
  const parent = path.dirname(hostPath);
  await mkdir(parent, { recursive: true });
  const [realOutboxRoot, realParent] = await Promise.all([realpath(outboxRoot), realpath(parent)]);
  assertInside(realOutboxRoot, realParent, { allowRoot: true });
  return hostPath;
}

function assertInside(root: string, target: string, options?: { allowRoot?: boolean }): void {
  const relative = path.relative(root, target);
  if (relative === "" && options?.allowRoot) return;
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error("Artifact path escapes the outbox directory");
  }
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned === value && cleaned.length > 0 && cleaned !== "." && cleaned !== "..") return cleaned;
  const safeBase = cleaned === "." || cleaned === ".." ? "item" : cleaned;
  const base = (safeBase || "item").slice(0, 80).replace(/-+$/g, "") || "item";
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
