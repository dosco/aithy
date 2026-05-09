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
        "Make a host path available to the sandbox. Folders are added to the global mount list (managed in Settings → Sandbox) and appear at /workspace/mounts/<name> in every sandbox. Files are copy-on-write copied into /workspace/inbox/<filename> in this conversation's workspace. Returns kind: 'directory' or 'file' so you know which case applied."
      )
      .arg("hostPath", f.string("Absolute host file or directory path"))
      .returnsField("kind", f.string("Either 'directory' (added to global mounts) or 'file' (copied to inbox)"))
      .returnsField("path", f.string("Sandbox path: /workspace/mounts/<name> for folders, /workspace/inbox/<filename> for files"))
      .returnsField("sizeBytes", f.number("File size in bytes (0 for directories)"))
      .returnsField("alreadyExisted", f.boolean("True if the folder was already in global mounts (idempotent no-op)"))
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
          const inboxDir = path.join(ctx.session.workspacePath, "inbox");
          await mkdir(inboxDir, { recursive: true });
          const safeName = await pickInboxName(inboxDir, path.basename(resolved));
          const dest = path.join(inboxDir, safeName);
          await copyFile(resolved, dest, fsConstants.COPYFILE_FICLONE);
          const sandboxPath = `/workspace/inbox/${safeName}`;
          ctx.notify?.({
            kind: "mount.added",
            title: "File added to workspace",
            body: `${path.basename(resolved)} copied (CoW) to ${sandboxPath}.`,
            link: null,
          });
          return {
            kind: "file",
            path: sandboxPath,
            sizeBytes: info.size,
            alreadyExisted: false,
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
        "Look up the sandbox path for a host path that has been added as a global mount. Returns an empty string if the path (or its parent) is not in the global mount list. Files copied via sandbox.mount are not tracked here — re-call sandbox.mount to copy again or use bash 'ls /workspace/inbox/' to find them."
      )
      .arg("hostPath", f.string("Absolute host path"))
      .returnsField("path", f.string("Sandbox path under /workspace/mounts, or empty string if not mounted"))
      .handler(async ({ hostPath }) => {
        // Use the live sandbox mount list (filters out paths missing on disk)
        // so we don't tell the agent about a mount the sandbox doesn't have.
        const mounts = ctx.sessions.mountsForSandbox();
        const exact = mounts.find((m) => m.hostPath === hostPath);
        if (exact) {
          return { path: `/workspace/mounts/${exact.mountName}` };
        }
        const parent = mounts
          .map((m) => ({ mount: m, rel: path.relative(m.hostPath, hostPath) }))
          .find(({ rel }) => rel && !rel.startsWith("..") && !path.isAbsolute(rel));
        if (parent) {
          return { path: `/workspace/mounts/${parent.mount.mountName}/${parent.rel}` };
        }
        return { path: "" };
      })
      .build(),
  ];
}

async function pickInboxName(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  let candidate = fileName;
  let suffix = 1;
  while (await exists(path.join(dir, candidate))) {
    candidate = `${base}-${suffix}${ext}`;
    suffix += 1;
  }
  return candidate;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
