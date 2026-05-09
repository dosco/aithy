import path from "node:path";

export function ensureRelativePath(input: string): string {
  const normalized = input.replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) {
    throw new Error("Path must be a non-empty relative path");
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("Path traversal is not allowed");
  }

  return parts.join("/");
}

export function safeJoin(root: string, relativePath: string): string {
  const safeRelative = ensureRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, safeRelative);
  if (!resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path escapes workspace root");
  }
  return resolvedPath;
}

export function basename(input: string): string {
  return path.basename(input.replaceAll("\\", "/"));
}
