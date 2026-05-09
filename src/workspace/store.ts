import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "./safe-path";

export interface WorkspaceDigest {
  root: string;
  artifactFiles: WorkspaceFile[];
}

export interface WorkspaceFile {
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
}

export class WorkspaceStore {
  constructor(private readonly root: string) {}

  async initConversation(conversationId: string): Promise<string> {
    const workspacePath = safeJoin(this.root, conversationId);
    await mkdir(path.join(workspacePath, "out"), { recursive: true });
    await mkdir(path.join(workspacePath, "mounts"), { recursive: true });
    await mkdir(path.join(workspacePath, "inbox"), { recursive: true });
    await mkdir(path.join(workspacePath, "_cache"), { recursive: true });
    return workspacePath;
  }

  async digest(workspacePath: string): Promise<WorkspaceDigest> {
    return {
      root: workspacePath,
      artifactFiles: await this.listDir(workspacePath, "out")
    };
  }

  private async listDir(root: string, relativeDir: string): Promise<WorkspaceFile[]> {
    const dir = relativeDir === "." ? root : safeJoin(root, relativeDir);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files: WorkspaceFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const fullPath = path.join(dir, entry.name);
      const info = await stat(fullPath);
      files.push({
        relativePath: path.relative(root, fullPath),
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString()
      });
    }

    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }
}
