import { ensureRelativePath } from "../workspace/safe-path";

const workspacePrefix = "/workspace";

export function sandboxWorkspacePath(relativePath: string): string {
  return `${workspacePrefix}/${ensureRelativePath(relativePath)}`;
}

export function normalizeSandboxCwd(cwd?: string): string {
  if (!cwd || cwd === "/workspace") return workspacePrefix;

  if (cwd.startsWith("/")) {
    if (cwd === workspacePrefix || cwd.startsWith(`${workspacePrefix}/`)) return cwd;
    throw new Error("Sandbox cwd must stay under /workspace");
  }

  return sandboxWorkspacePath(cwd);
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
