import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { resolveOutboxFile } from "../../src/artifacts/paths";
import { mimeTypeForPath } from "../../src/artifacts/preview";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { createSandboxProvider } from "../../src/sandbox/create-provider";
import { runSandboxDoctor } from "../../src/sandbox/health";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { applyRuntimeSettings } from "../../src/settings/resolve";
import { basename, ensureRelativePath } from "../../src/workspace/safe-path";
import { runtimeConsoleDto, staleRuntimeConsoleDto } from "./runtime-console.dto";

const consoleInput = z.object({
  logLimit: z.number().int().min(20).max(1000).optional(),
  commandLimit: z.number().int().min(20).max(1000).optional(),
}).optional();

export const getRuntimeConsole = createServerFn({ method: "GET" })
  .validator(consoleInput)
  .handler(async ({ data }) => {
    try {
      const runtime = await getAithyRuntime();
      return await runtimeConsoleDto(runtime, data);
    } catch (error) {
      return staleRuntimeConsoleDto(error, data);
    }
  });

export const retrySandboxSetup = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.queue.appendEvent({
      type: "setup-status",
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      key: "sandbox",
      label: "retrying sandbox setup",
      active: true,
      tone: "neutral",
    });
    await runtime.queue.submitCommand("sandbox-worker", "sandbox.reload_settings");
    return runtimeConsoleDto(runtime);
  });

const sandboxPathInput = z.object({
  path: z.string().min(1).max(2048),
});

export const listSandboxFiles = createServerFn({ method: "GET" })
  .validator(sandboxPathInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const sessionId = currentSandboxSessionId(runtime.runtimeStore.service("sandbox-worker")?.detail);
    if (!sessionId) return { sessionId: null, entries: [] };
    const target = workbenchPathParts(data.path);
    const result = await runtime.sandbox.bash(sessionId, {
      cwd: target.root,
      command: `python3 -c ${shellQuote(LIST_SANDBOX_FILES_SCRIPT)} ${shellQuote(target.root)} ${shellQuote(target.relativePath)}`,
      timeoutProfile: "short",
      maxOutputChars: 400_000,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to list ${data.path}`);
    return {
      sessionId,
      entries: JSON.parse(result.stdout) as SandboxFileEntry[],
    };
  });

export const deleteSandboxFile = createServerFn({ method: "POST" })
  .validator(sandboxPathInput.extend({
    recursive: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const sessionId = currentSandboxSessionId(runtime.runtimeStore.service("sandbox-worker")?.detail);
    if (!sessionId) throw new Error("No live sandbox session is available.");
    const target = workbenchPathParts(data.path, { root: "/outbox" });
    if (target.relativePath === ".") throw new Error("Refusing to delete the /outbox root.");
    const result = await runtime.sandbox.bash(sessionId, {
      cwd: target.root,
      command: `python3 -c ${shellQuote(DELETE_SANDBOX_FILE_SCRIPT)} ${shellQuote(target.root)} ${shellQuote(target.relativePath)} ${data.recursive ? "1" : "0"}`,
      timeoutProfile: "short",
      maxOutputChars: 20_000,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to delete ${data.path}`);
    return JSON.parse(result.stdout) as { deleted: boolean; path: string };
  });

export const downloadSandboxOutboxFile = createServerFn({ method: "POST" })
  .validator(sandboxPathInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const relativePath = outboxRelativePath(data.path);
    const resolved = await resolveOutboxFile(runtime.config.workspaceRoot, runtime.config.outboxRoot, data.path, relativePath);
    if (resolved.sizeBytes > 64 * 1024 * 1024) throw new Error("File is too large for inline console download.");
    const bytes = await readFile(resolved.hostPath);
    return {
      filename: basename(relativePath),
      mimeType: mimeTypeForPath(relativePath),
      sizeBytes: resolved.sizeBytes,
      base64: bytes.toString("base64"),
    };
  });

const sandboxTestInput = z.object({
  sandboxProvider: z.enum(["microsandbox", "disabled"]),
  sandboxImageSelection: z.unknown().optional(),
  customSandboxImages: z.unknown().optional(),
  sandboxCpus: z.number().int().min(1).max(16),
  sandboxMemoryMb: z.number().int().min(128).max(65536),
  sandboxNetwork: z.enum(["none", "public", "allow-all"]),
});

export const testSandboxImage = createServerFn({ method: "POST" })
  .validator(sandboxTestInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const config = applyRuntimeSettings(runtime.config, data as Parameters<typeof applyRuntimeSettings>[1]);
    const root = await mkdtemp(path.join(tmpdir(), "aithy-sandbox-test-"));
    const provider = createSandboxProvider(config);
    const session = await provider.createSession(`doctor-${crypto.randomUUID()}`, path.join(root, "workspace"), path.join(root, "outbox"), []);
    try {
      return await runSandboxDoctor({
        provider,
        sessionId: session.id,
        config,
        startedAt: new Date().toISOString(),
      });
    } finally {
      await provider.destroy(session.id).catch(() => undefined);
    }
  });

function currentSandboxSessionId(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const health = (detail as { health?: unknown }).health;
  if (!health || typeof health !== "object") return null;
  const sessionId = (health as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" && sessionId ? sessionId : null;
}

function outboxRelativePath(sandboxPath: string): string {
  const normalized = sandboxPath.replaceAll("\\", "/");
  if (!normalized.startsWith("/outbox/")) throw new Error("Download is limited to /outbox files.");
  return ensureRelativePath(normalized.slice("/outbox/".length));
}

interface SandboxFileEntry {
  path: string;
  name: string;
  kind: "file" | "directory" | "other";
  sizeBytes: number;
  modifiedAt: string | null;
}

function workbenchPathParts(input: string, options: { root?: "/workspace" | "/outbox" } = {}): {
  root: "/workspace" | "/outbox";
  relativePath: string;
} {
  const normalized = input.replaceAll("\\", "/").replace(/\/+$/g, "") || "/workspace";
  const root = options.root ?? (normalized === "/outbox" || normalized.startsWith("/outbox/") ? "/outbox" : "/workspace");
  if (normalized !== root && !normalized.startsWith(`${root}/`)) throw new Error(`Path must be under ${root}.`);
  const rest = normalized === root ? "" : normalized.slice(root.length + 1);
  return { root, relativePath: rest ? ensureRelativePath(rest) : "." };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const LIST_SANDBOX_FILES_SCRIPT = `
import json, os, sys

root = sys.argv[1].rstrip("/")
rel = sys.argv[2]
target = "." if rel == "." else rel
base = root if rel == "." else root + "/" + rel

def entry_for(item):
    path = item.path
    try:
        st = os.stat(path, follow_symlinks=False)
        mtime = __import__("datetime").datetime.fromtimestamp(
            st.st_mtime,
            __import__("datetime").timezone.utc,
        ).isoformat().replace("+00:00", "Z")
        size = st.st_size
    except OSError:
        mtime = None
        size = 0
    kind = "directory" if item.is_dir(follow_symlinks=False) else "file" if item.is_file(follow_symlinks=False) else "other"
    return {
        "path": base.rstrip("/") + "/" + item.name,
        "name": item.name,
        "kind": kind,
        "sizeBytes": size,
        "modifiedAt": mtime,
    }

entries = [entry_for(item) for item in os.scandir(target)]
entries.sort(key=lambda item: (item["kind"] != "directory", item["name"].lower()))
print(json.dumps(entries))
`;

const DELETE_SANDBOX_FILE_SCRIPT = `
import json, os, shutil, sys

root = sys.argv[1].rstrip("/")
rel = sys.argv[2]
recursive = sys.argv[3] == "1"
if rel == ".":
    raise SystemExit("Refusing to delete root")
target = rel
out = {"deleted": False, "path": root + "/" + rel}
if os.path.isdir(target) and not os.path.islink(target):
    if recursive:
        shutil.rmtree(target)
        out["deleted"] = True
    else:
        os.rmdir(target)
        out["deleted"] = True
elif os.path.exists(target) or os.path.islink(target):
    os.remove(target)
    out["deleted"] = True
print(json.dumps(out))
`;
