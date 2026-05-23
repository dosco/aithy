import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { prepareGlobalMounts } from "../app/server/settings-mounts";

describe("prepareGlobalMounts", () => {
  test("canonicalizes existing directories, dedups them, and keeps missing paths skipped", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-settings-mounts-"));
    const workspace = path.join(root, "workspace");
    const folder = path.join(root, "folder");
    const missing = path.join(root, "missing");
    await mkdir(workspace);
    await mkdir(folder);

    const result = await prepareGlobalMounts([
      { hostPath: folder },
      { hostPath: folder },
      { hostPath: missing },
    ], workspace);

    expect(result).toEqual({
      mounts: [
        { hostPath: await realpath(folder) },
        { hostPath: missing },
      ],
      skippedPaths: [missing],
    });
  });

  test("rejects existing files and workspace descendants", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-settings-mounts-reject-"));
    const workspace = path.join(root, "workspace");
    const workspaceChild = path.join(workspace, "data");
    const file = path.join(root, "file.txt");
    await mkdir(workspace);
    await mkdir(workspaceChild);
    await writeFile(file, "hello");

    await expect(prepareGlobalMounts([{ hostPath: file }], workspace))
      .rejects.toThrow("directory");
    await expect(prepareGlobalMounts([{ hostPath: workspaceChild }], workspace))
      .rejects.toThrow("inside the workspace root");
    await expect(prepareGlobalMounts([{ hostPath: path.join(workspace, "missing") }], workspace))
      .rejects.toThrow("inside the workspace root");
  });
});
