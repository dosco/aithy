import { readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import {
  LOCAL_CHAT_MODEL_ALIAS,
  LOCAL_EMBEDDING_MODEL_ALIAS,
  LOCAL_RERANKER_MODEL_ALIAS,
} from "./manifest";
import type { LocalInferenceSettings } from "./settings";
import { warmLocalAgentCache } from "./warmup";

const CORE_ALIASES = [
  LOCAL_EMBEDDING_MODEL_ALIAS,
  LOCAL_RERANKER_MODEL_ALIAS,
] as const;
export const LLAMA_ROUTER_MARKER_FILE = "router.json";
const STALE_ROUTER_SHUTDOWN_GRACE_MS = 5_000;

export interface LlamaRouterProcess {
  proc: ReturnType<typeof Bun.spawn>;
  baseUrl: string;
  port: number;
}

export interface LlamaRouterMarker {
  pid: number;
  port: number;
  baseUrl: string;
  binaryPath: string;
  modelsIniPath: string;
  startedAt: string;
  workerPid: number;
}

export type LlamaRouterCleanupResult =
  | { status: "missing" | "dead" | "invalid"; pid?: number }
  | { status: "killed" | "unmatched"; pid: number };

interface CleanupDeps {
  readText?: (filePath: string) => Promise<string>;
  unlink?: (filePath: string) => Promise<void>;
  inspectCommand?: (pid: number) => Promise<string | null>;
  kill?: (pid: number, signal: NodeJS.Signals | 0) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate loopback port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export async function startLlamaRouter(input: {
  binaryPath: string;
  modelsIniPath: string;
  settings: LocalInferenceSettings;
  cwd: string;
  markerPath?: string;
  env?: Record<string, string | undefined>;
}): Promise<LlamaRouterProcess> {
  if (input.markerPath) await cleanupStaleLlamaRouter(input.markerPath);
  const port = await allocateLoopbackPort();
  const proc = Bun.spawn([
    input.binaryPath,
    "--models-preset",
    input.modelsIniPath,
    "--models-max",
    String(input.settings.modelsMax),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...input.env },
  });
  if (input.markerPath) {
    try {
      await writeLlamaRouterMarker(input.markerPath, {
        pid: processPid(proc),
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        binaryPath: input.binaryPath,
        modelsIniPath: input.modelsIniPath,
        startedAt: new Date().toISOString(),
        workerPid: process.pid,
      });
    } catch (error) {
      proc.kill("SIGTERM");
      throw error;
    }
  }
  return { proc, port, baseUrl: `http://127.0.0.1:${port}` };
}

export async function cleanupStaleLlamaRouter(
  markerPath: string,
  deps: CleanupDeps = {},
): Promise<LlamaRouterCleanupResult> {
  const marker = await readLlamaRouterMarker(markerPath, deps);
  if (!marker) return { status: "missing" };
  if (!validMarker(marker)) {
    await safeUnlink(markerPath, deps);
    return { status: "invalid" };
  }
  const command = await (deps.inspectCommand ?? inspectCommand)(marker.pid);
  if (!command) {
    await safeUnlink(markerPath, deps);
    return { status: "dead", pid: marker.pid };
  }
  if (!commandMatchesMarker(command, marker)) {
    return { status: "unmatched", pid: marker.pid };
  }
  await terminatePid(marker.pid, deps);
  await safeUnlink(markerPath, deps);
  return { status: "killed", pid: marker.pid };
}

export async function writeLlamaRouterMarker(
  markerPath: string,
  marker: LlamaRouterMarker,
): Promise<void> {
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
}

export async function removeLlamaRouterMarker(
  markerPath: string,
  pid?: number,
): Promise<void> {
  if (pid !== undefined) {
    const marker = await readLlamaRouterMarker(markerPath);
    if (marker && validMarker(marker) && marker.pid !== pid) return;
  }
  await safeUnlink(markerPath);
}

export async function waitForRouterReady(
  baseUrl: string,
  input: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const deadline = Date.now() + (input.timeoutMs ?? 120_000);
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`${baseUrl}/models?reload=1`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`llama-server did not become ready: ${errorMessage(lastError)}`);
}

export async function loadAndWarmRouter(
  input: {
    baseUrl: string;
    includeChat?: boolean;
    fetchImpl?: typeof fetch;
    onStep?: (step: string) => void;
  },
): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const aliases = routerAliases(input.includeChat === true);
  for (const alias of aliases) {
    input.onStep?.(`loading ${alias}`);
    await postJson(`${input.baseUrl}/models/load`, { model: alias }, fetchImpl).catch(() => undefined);
  }
  await waitForModelsLoaded(input.baseUrl, { fetchImpl, aliases });
  input.onStep?.(`warming ${LOCAL_EMBEDDING_MODEL_ALIAS}`);
  await postJson(`${input.baseUrl}/v1/embeddings`, {
    model: LOCAL_EMBEDDING_MODEL_ALIAS,
    input: "hello",
    encoding_format: "float",
  }, fetchImpl);
  input.onStep?.(`warming ${LOCAL_RERANKER_MODEL_ALIAS}`);
  await postJson(`${input.baseUrl}/v1/rerank`, {
    model: LOCAL_RERANKER_MODEL_ALIAS,
    query: "hello",
    documents: ["hello"],
    top_n: 1,
  }, fetchImpl);
  if (input.includeChat === true) {
    input.onStep?.(`warming ${LOCAL_CHAT_MODEL_ALIAS}`);
    await warmLocalAgentCache({
      baseUrl: input.baseUrl,
      modelId: LOCAL_CHAT_MODEL_ALIAS,
      fetchImpl,
    });
  }
}

async function waitForModelsLoaded(
  baseUrl: string,
  input: { fetchImpl: typeof fetch; aliases: readonly string[]; timeoutMs?: number },
): Promise<void> {
  const deadline = Date.now() + (input.timeoutMs ?? 180_000);
  let missing = [...input.aliases];
  while (Date.now() < deadline) {
    const response = await input.fetchImpl(`${baseUrl}/models?reload=1`);
    if (response.ok) {
      const body = await response.json() as { data?: Array<{ id?: string; status?: { value?: string } }> };
      const rows = Array.isArray(body.data) ? body.data : [];
      missing = input.aliases.filter((alias) => {
        const row = rows.find((item) => item.id === alias);
        return row?.status?.value !== "loaded";
      });
      if (missing.length === 0) return;
    }
    await delay(1_000);
  }
  throw new Error(`llama-server did not load models: ${missing.join(", ")}`);
}

function routerAliases(includeChat: boolean): readonly string[] {
  return includeChat ? [LOCAL_CHAT_MODEL_ALIAS, ...CORE_ALIASES] : CORE_ALIASES;
}

async function readLlamaRouterMarker(
  markerPath: string,
  deps: CleanupDeps = {},
): Promise<unknown | null> {
  try {
    return JSON.parse(await (deps.readText ?? ((filePath) => readFile(filePath, "utf8")))(markerPath));
  } catch (error) {
    if (isNotFound(error)) return null;
    return {};
  }
}

function validMarker(value: unknown): value is LlamaRouterMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as LlamaRouterMarker;
  return Number.isInteger(marker.pid)
    && marker.pid > 0
    && Number.isInteger(marker.port)
    && marker.port > 0
    && typeof marker.binaryPath === "string"
    && marker.binaryPath.length > 0
    && typeof marker.modelsIniPath === "string"
    && marker.modelsIniPath.length > 0;
}

async function inspectCommand(pid: number): Promise<string | null> {
  const proc = Bun.spawn(["ps", "-p", String(pid), "-o", "command="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const output = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) return null;
  const command = output.trim();
  return command || null;
}

function commandMatchesMarker(command: string, marker: LlamaRouterMarker): boolean {
  return command.includes(marker.binaryPath)
    && command.includes("--models-preset")
    && command.includes(marker.modelsIniPath)
    && new RegExp(`(?:^|\\s)--port\\s+${marker.port}(?:\\s|$)`).test(command);
}

async function terminatePid(pid: number, deps: CleanupDeps): Promise<void> {
  const kill = deps.kill ?? defaultKill;
  const sleepFn = deps.sleep ?? delay;
  if (!kill(pid, "SIGTERM")) return;
  const deadline = Date.now() + STALE_ROUTER_SHUTDOWN_GRACE_MS;
  while (Date.now() < deadline) {
    await sleepFn(100);
    if (!kill(pid, 0)) return;
  }
  kill(pid, "SIGKILL");
}

function defaultKill(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(markerPath: string, deps: CleanupDeps = {}): Promise<void> {
  try {
    await (deps.unlink ?? unlink)(markerPath);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function processPid(proc: ReturnType<typeof Bun.spawn>): number {
  const pid = (proc as { pid?: unknown }).pid;
  if (typeof pid !== "number") throw new Error("llama-server process did not expose a pid");
  return pid;
}

async function postJson<T = unknown>(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url} failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
