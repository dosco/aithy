import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { f, fn } from "@ax-llm/ax";
import type { ToolContext } from "../tool-context";

export function createMountTools(ctx: ToolContext) {
  return [
    fn("mount")
      .namespace("sandbox")
      .description(
        "Make a host path available to the sandbox. Folders are added to the global mount list (managed in Settings → Sandbox) and appear at /mounts/<name> in the sandbox. Files are copy-on-write copied into /workspace/<filename> in the bot's shared workspace. Returns kind: 'directory' or 'file' so you know which case applied."
      )
      .arg("hostPath", f.string("Absolute host file or directory path"))
      .returnsField("kind", f.string("Either 'directory' (added to global mounts) or 'file' (copied to /workspace)"))
      .returnsField("path", f.string("Sandbox path: /mounts/<name> for folders, /workspace/<filename> for files"))
      .returnsField("sizeBytes", f.number("File size in bytes (0 for directories)"))
      .returnsField("alreadyExisted", f.boolean("True if the folder was already in global mounts, or the file was already copied with the same source path (idempotent no-op)"))
      .handler(async ({ hostPath }) => {
        const resolved = await realpath(hostPath);
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
          const placement = await pickWorkspaceName(ctx.workspacePath, resolved);
          const dest = path.join(ctx.workspacePath, placement.fileName);
          if (!placement.alreadyExisted) {
            await cowCopy(resolved, dest);
          }
          const sandboxPath = `/workspace/${placement.fileName}`;
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

    fn("getPath")
      .namespace("sandbox")
      .description(
        "Look up the sandbox path for a host path that has been added as a global mount. Returns an empty string if the path (or its parent) is not in the global mount list. Files copied via sandbox.mount are not tracked here — re-call sandbox.mount to copy again or use bash 'ls /workspace/' to find them."
      )
      .arg("hostPath", f.string("Absolute host path"))
      .returnsField("path", f.string("Sandbox path under /mounts, or empty string if not mounted"))
      .handler(async ({ hostPath }) => {
        // Use the live sandbox mount list (filters out paths missing on disk)
        // so we don't tell the agent about a mount the sandbox doesn't have.
        const mounts = ctx.sessions.mountsForSandbox();
        const exact = mounts.find((m) => m.hostPath === hostPath);
        if (exact) {
          return { path: `/mounts/${exact.mountName}` };
        }
        const parent = mounts
          .map((m) => ({ mount: m, rel: path.relative(m.hostPath, hostPath) }))
          .find(({ rel }) => rel && !rel.startsWith("..") && !path.isAbsolute(rel));
        if (parent) {
          return { path: `/mounts/${parent.mount.mountName}/${parent.rel}` };
        }
        return { path: "" };
      })
      .build(),
  ];
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
  const ext = path.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const direct = path.join(workspaceDir, fileName);
  const directExists = await exists(direct);
  const directSameSource = directExists && (await sameInode(direct, resolvedSource));
  if (!directExists) return { fileName, alreadyExisted: false };
  if (directSameSource) return { fileName, alreadyExisted: true };
  const suffix = createHash("sha256").update(resolvedSource).digest("hex").slice(0, 8);
  const suffixedName = `${base}-${suffix}${ext}`;
  const suffixed = path.join(workspaceDir, suffixedName);
  const suffixedExists = await exists(suffixed);
  const suffixedSameSource = suffixedExists && (await sameInode(suffixed, resolvedSource));
  return { fileName: suffixedName, alreadyExisted: suffixedSameSource };
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
