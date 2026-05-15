import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { safeJoin } from "../workspace/safe-path";

export async function listRunOutboxFiles(
  outboxRoot: string,
  runOutboxRelativePath: string,
): Promise<string[]> {
  const runRoot = safeJoin(outboxRoot, runOutboxRelativePath);
  let realOutboxRoot: string;
  let realRunRoot: string;
  try {
    [realOutboxRoot, realRunRoot] = await Promise.all([realpath(outboxRoot), realpath(runRoot)]);
  } catch {
    return [];
  }
  assertInside(realOutboxRoot, realRunRoot);
  return walk(realOutboxRoot, realRunRoot);
}

async function walk(realOutboxRoot: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      files.push(...await walk(realOutboxRoot, fullPath));
    } else if (entry.isFile()) {
      const relative = path.relative(realOutboxRoot, fullPath);
      if (!relative.startsWith("..") && !path.isAbsolute(relative)) files.push(relative.replaceAll(path.sep, "/"));
    }
  }
  return files.sort();
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new Error("Run outbox path escapes the outbox directory");
  }
}
