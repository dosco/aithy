import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { f, fn } from "@ax-llm/ax";
import { requireToolPermission } from "../../security/permission-gate";
import type { ToolContext } from "../tool-context";

export function createMountTools(ctx: ToolContext) {
  return [
    fn("mount")
      .namespace("sandbox")
      .description(
        "Make a host path available to the sandbox. Folders are added as read-only global mounts (managed in Settings → Sandbox) and appear at /mounts/<name>. Files are copy-on-write copied into /workspace/<filename> in the bot's shared workspace. Returns kind: 'directory' or 'file' so you know which case applied."
      )
      .arg("hostPath", f.string("Absolute host file or directory path"))
      .returnsField("kind", f.string("Either 'directory' (added to global mounts) or 'file' (copied to /workspace)"))
      .returnsField("path", f.string("Sandbox path: /mounts/<name> for folders, /workspace/<filename> for files"))
      .returnsField("sizeBytes", f.number("File size in bytes (0 for directories)"))
      .returnsField("alreadyExisted", f.boolean("True if the folder was already in global mounts, or the file was already copied with the same source path (idempotent no-op)"))
      .handler(async ({ hostPath }) => {
        const requestedPath = path.resolve(hostPath);
        await requireToolPermission(ctx, {
          capability: "sandbox.mount",
          toolName: "sandbox.mount",
          command: `mount ${requestedPath}`,
          reason: "Allow the agent to expose this host path to the sandbox.",
          targetKind: "host_path",
          targetValue: requestedPath,
          matchContext: { hostPath: requestedPath },
          args: { hostPath: requestedPath },
        });
        const resolved = await realpath(requestedPath);
        const info = await stat(resolved);

        if (info.isDirectory()) {
          const result = await ctx.sessions.addGlobalMount(
            resolved,
            ctx.session.conversationId,
          );
          if (!result.alreadyExisted) {
            ctx.notify?.({
              kind: "mount.added",
              title: "Folder mounted",
              body: `${path.basename(resolved)} is now available in every sandbox at ${result.sandboxPath}. Manage in Settings → Sandbox.`,
              link: "/settings",
            });
          }
          return {
            kind: "directory",
            path: result.sandboxPath,
            sizeBytes: 0,
            alreadyExisted: result.alreadyExisted,
          };
        }

        if (info.isFile()) {
          await mkdir(ctx.workspacePath, { recursive: true });
          const placement = await existingCopiedPlacement(ctx, resolved)
            ?? await pickWorkspaceName(ctx.workspacePath, resolved);
          const dest = path.join(ctx.workspacePath, placement.fileName);
          if (!placement.alreadyExisted) {
            await cowCopy(resolved, dest);
          }
          const sandboxPath = `/workspace/${placement.fileName}`;
          recordCopiedPlacement(ctx, {
            resolvedSource: resolved,
            sandboxPath,
            workspacePath: dest,
            sizeBytes: info.size,
          });
          if (!placement.alreadyExisted) {
            ctx.notify?.({
              kind: "mount.added",
              title: "File added to workspace",
              body: `${path.basename(resolved)} copied (CoW) to ${sandboxPath}.`,
              link: null,
            });
          }
          return {
            kind: "file",
            path: sandboxPath,
            sizeBytes: info.size,
            alreadyExisted: placement.alreadyExisted,
          };
        }

        throw new Error(
          `Cannot mount ${resolved}: not a regular file or directory (mode ${info.mode.toString(8)})`,
        );
      })
      .build(),

    createResolveHostPathTool(ctx, "resolveHostPath"),
    createResolveHostPathTool(ctx, "getPath"),
  ];
}

function createResolveHostPathTool(ctx: ToolContext, name: "resolveHostPath" | "getPath") {
  const toolName = `sandbox.${name}`;
  const description = name === "resolveHostPath"
    ? "Resolve an absolute host file or directory path to its sandbox path if it is already available. Mounted folders resolve to /mounts/<name>. Files copied by sandbox.mount resolve from recorded copy provenance. Returns an empty string if unavailable. This is not for finding published artifacts; use artifact.find for artifacts."
    : "Compatibility alias for sandbox.resolveHostPath. Use this only for absolute host paths that may already be mounted or copied into the sandbox, not for artifacts; use artifact.find for artifacts.";
  return fn(name)
    .namespace("sandbox")
    .description(description)
    .arg("hostPath", f.string("Absolute host path"))
    .returnsField("path", f.string("Sandbox path under /mounts or /workspace, or empty string if unavailable"))
    .handler(async ({ hostPath }) => {
      const requestedPath = path.resolve(hostPath);
      await requireToolPermission(ctx, {
        capability: "sandbox.getPath",
        toolName,
        command: `resolve sandbox path for ${requestedPath}`,
        reason: "Allow the agent to inspect whether this host path is available in the sandbox.",
        targetKind: "host_path",
        targetValue: requestedPath,
        matchContext: { hostPath: requestedPath },
        args: { hostPath: requestedPath },
      });
      const copied = await copiedFileRecord(ctx, requestedPath);
      const sandboxPath = await resolveSandboxPathForHostPath({
        hostPath: requestedPath,
        mounts: ctx.sessions.mountsForSandbox(),
        workspacePath: ctx.workspacePath,
        copiedFiles: copied ? [copied] : [],
      });
      return { path: sandboxPath };
    })
    .build();
}

export async function resolveSandboxPathForHostPath(input: {
  hostPath: string;
  mounts: Array<{ hostPath: string; mountName: string }>;
  workspacePath: string;
  copiedFiles?: Array<{ sourcePath: string; sandboxPath: string; workspacePath?: string }>;
}): Promise<string> {
  let resolved: string;
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    resolved = await realpath(input.hostPath);
    info = await stat(resolved);
  } catch {
    return "";
  }

  const mountedPath = sandboxPathForMountedHostPath(input.mounts, resolved);
  if (mountedPath) return mountedPath;
  if (!info.isFile()) return "";

  return sandboxPathForCopiedFile(input.copiedFiles ?? [], resolved);
}

function sandboxPathForMountedHostPath(
  mounts: Array<{ hostPath: string; mountName: string }>,
  hostPath: string,
): string {
  const exact = mounts.find((m) => m.hostPath === hostPath);
  if (exact) return `/mounts/${exact.mountName}`;

  const parent = mounts
    .map((m) => ({ mount: m, rel: path.relative(m.hostPath, hostPath) }))
    .filter(({ rel }) => rel && !rel.startsWith("..") && !path.isAbsolute(rel))
    .sort((a, b) => a.rel.length - b.rel.length)
    .at(0);
  if (!parent) return "";

  return `/mounts/${parent.mount.mountName}/${parent.rel}`;
}

async function sandboxPathForCopiedFile(
  copiedFiles: Array<{ sourcePath: string; sandboxPath: string; workspacePath?: string }>,
  resolvedSource: string,
): Promise<string> {
  const copied = copiedFiles.find((file) => file.sourcePath === resolvedSource);
  if (!copied) return "";
  if (copied.workspacePath && !(await exists(copied.workspacePath))) return "";
  return copied.sandboxPath;
}

async function copiedFileRecord(ctx: ToolContext, requestedPath: string) {
  if (!ctx.runtimeStore) return null;
  try {
    return ctx.runtimeStore.sandboxFileMount(await realpath(requestedPath));
  } catch {
    return null;
  }
}

async function existingCopiedPlacement(ctx: ToolContext, resolvedSource: string): Promise<WorkspacePlacement | null> {
  const existing = ctx.runtimeStore?.sandboxFileMount(resolvedSource);
  if (!existing || !(await exists(existing.workspacePath))) return null;
  const fileName = existing.sandboxPath.startsWith("/workspace/")
    ? existing.sandboxPath.slice("/workspace/".length)
    : path.basename(existing.workspacePath);
  return { fileName, alreadyExisted: true };
}

function recordCopiedPlacement(ctx: ToolContext, input: {
  resolvedSource: string;
  sandboxPath: string;
  workspacePath: string;
  sizeBytes: number;
}): void {
  ctx.runtimeStore?.recordSandboxFileMount({
    sourcePath: input.resolvedSource,
    sandboxPath: input.sandboxPath,
    workspacePath: input.workspacePath,
    sizeBytes: input.sizeBytes,
  });
}

interface WorkspacePlacement {
  fileName: string;
  alreadyExisted: boolean;
}

async function pickWorkspaceName(
  workspaceDir: string,
  resolvedSource: string,
): Promise<WorkspacePlacement> {
  const fileName = path.basename(resolvedSource);
  const direct = path.join(workspaceDir, fileName);
  const directExists = await exists(direct);
  const directSameSource = directExists && (await sameInode(direct, resolvedSource));
  if (!directExists) return { fileName, alreadyExisted: false };
  if (directSameSource) return { fileName, alreadyExisted: true };
  const suffixedName = hashedWorkspaceName(resolvedSource);
  const suffixed = path.join(workspaceDir, suffixedName);
  const suffixedExists = await exists(suffixed);
  const suffixedSameSource = suffixedExists && (await sameInode(suffixed, resolvedSource));
  return { fileName: suffixedName, alreadyExisted: suffixedSameSource };
}

function hashedWorkspaceName(resolvedSource: string): string {
  const fileName = path.basename(resolvedSource);
  const ext = path.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const suffix = createHash("sha256").update(resolvedSource).digest("hex").slice(0, 8);
  return `${base}-${suffix}${ext}`;
}

async function cowCopy(src: string, dest: string): Promise<void> {
  try {
    await copyFile(src, dest, fsConstants.COPYFILE_FICLONE);
    return;
  } catch {
    await copyFile(src, dest);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sameInode(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([stat(a), stat(b)]);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}
