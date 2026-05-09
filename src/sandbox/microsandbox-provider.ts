import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { NetworkPolicy, Sandbox } from "microsandbox";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  MAX_SANDBOX_INLINE_BYTES,
  MAX_TOOL_OUTPUT_CHARS
} from "../config/limits";
import { ensureRelativePath } from "../workspace/safe-path";
import { trimOutput } from "./command";
import type {
  SandboxBashRequest,
  SandboxBashResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
  SessionMount
} from "./provider";
import { normalizeSandboxCwd, sandboxWorkspacePath, shellQuote } from "./sandbox-paths";

export interface MicrosandboxOptions {
  image: string;
  cpus: number;
  memoryMb: number;
  network: "none" | "public" | "allow-all";
  sandboxFactory?: typeof Sandbox;
}

type SandboxState = "live" | "parked";

interface SandboxEntry {
  sandbox: any;
  hostWorkspacePath: string;
  mounts: SessionMount[];
  state: SandboxState;
}

const CACHE_ENV_VARS: Record<string, string> = {
  npm_config_cache: "/cache/npm",
  PIP_CACHE_DIR: "/cache/pip",
  XDG_CACHE_HOME: "/cache/xdg",
  HF_HOME: "/cache/hf",
};

export class MicrosandboxProvider implements SandboxProvider {
  private readonly sandboxes = new Map<string, SandboxEntry>();

  constructor(private readonly options: MicrosandboxOptions) {}

  async createSession(
    conversationId: string,
    hostWorkspacePath: string,
    mounts: SessionMount[]
  ): Promise<SandboxSession> {
    const name = sandboxNameFor(conversationId);
    await ensureHostWorkspace(hostWorkspacePath);
    const sandbox = await this.createSandbox(name, hostWorkspacePath, mounts);
    this.sandboxes.set(name, { sandbox, hostWorkspacePath, mounts: [...mounts], state: "live" });
    return { id: name, name };
  }

  async recreate(
    sessionId: string,
    hostWorkspacePath: string,
    mounts: SessionMount[]
  ): Promise<SandboxSession> {
    const existing = this.sandboxes.get(sessionId);
    if (existing) {
      this.sandboxes.delete(sessionId);
      if (existing.state === "live") await stopSandbox(existing.sandbox);
    }
    await ensureHostWorkspace(hostWorkspacePath);
    const sandbox = await this.createSandbox(sessionId, hostWorkspacePath, mounts);
    this.sandboxes.set(sessionId, { sandbox, hostWorkspacePath, mounts: [...mounts], state: "live" });
    return { id: sessionId, name: sessionId };
  }

  async bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult> {
    await this.ensureLive(sessionId);
    const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS);
    const cwd = normalizeSandboxCwd(request.cwd);
    const command = `cd ${shellQuote(cwd)} && ${request.command}`;

    const result = await this.execWithTimeout(sessionId, "bash", ["-lc", command], timeoutMs);
    const maxChars = request.maxOutputChars ?? MAX_TOOL_OUTPUT_CHARS;
    return {
      exitCode: result.exitCode,
      stdout: trimOutput(result.stdout, maxChars),
      stderr: trimOutput(result.stderr, maxChars),
      timedOut: result.timedOut
    };
  }

  async read(sessionId: string, sandboxPath: string, maxBytes = MAX_SANDBOX_INLINE_BYTES): Promise<string> {
    await this.ensureLive(sessionId);
    const safeSandboxPath = toWorkspacePath(sandboxPath);
    const content = await this.fs(sessionId).readToString(safeSandboxPath);
    return content.length > maxBytes ? content.slice(0, maxBytes) : content;
  }

  async write(sessionId: string, sandboxPath: string, content: string): Promise<SandboxFile> {
    await this.ensureLive(sessionId);
    const safeSandboxPath = toWorkspacePath(sandboxPath);
    await this.mkdirp(sessionId, path.posix.dirname(safeSandboxPath));
    await this.fs(sessionId).write(safeSandboxPath, content);
    return { path: safeSandboxPath, sizeBytes: Buffer.byteLength(content) };
  }

  async edit(sessionId: string, sandboxPath: string, search: string, replace: string): Promise<SandboxFile> {
    const text = await this.read(sessionId, sandboxPath, MAX_SANDBOX_INLINE_BYTES);
    const index = text.indexOf(search);
    if (index === -1) throw new Error("Search text not found in sandbox file");
    const updated = `${text.slice(0, index)}${replace}${text.slice(index + search.length)}`;
    return this.write(sessionId, sandboxPath, updated);
  }

  async park(sessionId: string): Promise<void> {
    const entry = this.sandboxes.get(sessionId);
    if (!entry || entry.state === "parked") return;
    // Stop the VM but keep the database record + host volumes so resume() can rebuild it.
    if (typeof entry.sandbox.stopAndWait === "function") await entry.sandbox.stopAndWait();
    else if (typeof entry.sandbox.stop === "function") await entry.sandbox.stop();
    entry.state = "parked";
    entry.sandbox = null;
  }

  async resume(sessionId: string): Promise<void> {
    const entry = this.sandboxes.get(sessionId);
    if (!entry) throw new Error(`Microsandbox session not found: ${sessionId}`);
    if (entry.state === "live" && entry.sandbox) return;
    const factory = this.options.sandboxFactory ?? Sandbox;
    if (typeof (factory as any)?.get !== "function") {
      // SDK does not expose Sandbox.get — rebuild from scratch using the same builder pipeline.
      entry.sandbox = await this.createSandbox(sessionId, entry.hostWorkspacePath, entry.mounts);
      entry.state = "live";
      return;
    }
    try {
      const handle = await (factory as any).get(sessionId);
      entry.sandbox = await handle.startDetached();
    } catch {
      // No persisted record (or it was lost) — build a fresh VM with the same configuration.
      entry.sandbox = await this.createSandbox(sessionId, entry.hostWorkspacePath, entry.mounts);
    }
    entry.state = "live";
  }

  async destroy(sessionId: string): Promise<void> {
    const entry = this.sandboxes.get(sessionId);
    this.sandboxes.delete(sessionId);
    if (!entry) return;
    if (entry.state === "live" && entry.sandbox) {
      await stopSandbox(entry.sandbox);
    } else {
      // Parked: VM is already stopped; remove the persisted DB record so the name is reusable.
      const factory = this.options.sandboxFactory ?? Sandbox;
      if (typeof (factory as any)?.remove === "function") {
        await (factory as any).remove(sessionId).catch(() => undefined);
      }
    }
    // Clean up the per-session cache directory (workspace itself is owned by WorkspaceStore).
    const cacheDir = path.join(entry.hostWorkspacePath, "_cache");
    await rm(cacheDir, { recursive: true, force: true }).catch(() => undefined);
  }

  private async ensureLive(sessionId: string): Promise<void> {
    const entry = this.sandboxes.get(sessionId);
    if (!entry) throw new Error(`Microsandbox session not found: ${sessionId}`);
    if (entry.state === "parked" || !entry.sandbox) {
      await this.resume(sessionId);
    }
  }

  private async createSandbox(
    name: string,
    hostWorkspacePath: string,
    mounts: SessionMount[]
  ): Promise<any> {
    const factory = this.options.sandboxFactory ?? Sandbox;
    if (!factory?.builder) throw new Error("Microsandbox SDK does not expose Sandbox.builder(...). Install a local no-key microsandbox package.");

    try {
      let builder = factory.builder(name).image(this.options.image).cpus(this.options.cpus).memory(this.options.memoryMb).replace();
      builder = applyBundledRuntime(builder);
      builder = applyNetwork(builder, this.options.network);
      builder = builder.volume("/workspace", (v: any) => v.bind(hostWorkspacePath));
      builder = builder.volume("/cache", (v: any) => v.bind(path.join(hostWorkspacePath, "_cache")));
      for (const mount of mounts) {
        builder = builder.volume(`/workspace/mounts/${mount.mountName}`, (v: any) => v.bind(mount.hostPath));
      }
      builder = applyCacheEnv(builder);
      return await builder.create();
    } catch (error) {
      throw new Error(`Failed to start Microsandbox microVM: ${formatMicrosandboxStartError(error)}`);
    }
  }

  private async execWithTimeout(sessionId: string, cmd: string, args: string[], timeoutMs: number) {
    const sandbox = this.getEntry(sessionId).sandbox;
    let didTimeOut = false;
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        didTimeOut = true;
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs).unref();
    });

    try {
      const output = await Promise.race([sandbox.exec(cmd, args), timeout]);
      return { exitCode: output.code ?? 0, stdout: output.stdout(), stderr: output.stderr(), timedOut: false };
    } catch (error) {
      if (!didTimeOut) throw error;
      return { exitCode: 124, stdout: "", stderr: formatError(error), timedOut: true };
    }
  }

  private async mkdirp(sessionId: string, sandboxPath: string): Promise<void> {
    const result = await this.execWithTimeout(sessionId, "mkdir", ["-p", sandboxPath], 30_000);
    if (result.exitCode !== 0) throw new Error(result.stderr || `Failed to create ${sandboxPath}`);
  }

  private fs(sessionId: string): any {
    return this.getEntry(sessionId).sandbox.fs();
  }

  private getEntry(sessionId: string): SandboxEntry {
    const entry = this.sandboxes.get(sessionId);
    if (!entry) throw new Error(`Microsandbox session not found: ${sessionId}`);
    return entry;
  }
}

export function sandboxNameFor(conversationId: string): string {
  return `aithy-${conversationId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
}

async function ensureHostWorkspace(hostWorkspacePath: string): Promise<void> {
  await mkdir(path.join(hostWorkspacePath, "inbox"), { recursive: true });
  await mkdir(path.join(hostWorkspacePath, "out"), { recursive: true });
  await mkdir(path.join(hostWorkspacePath, "mounts"), { recursive: true });
  await mkdir(path.join(hostWorkspacePath, "_cache"), { recursive: true });
}

function applyCacheEnv(builder: any) {
  if (typeof builder.envs === "function") return builder.envs(CACHE_ENV_VARS);
  if (typeof builder.env === "function") {
    let next = builder;
    for (const [key, value] of Object.entries(CACHE_ENV_VARS)) next = next.env(key, value);
    return next;
  }
  return builder;
}

function applyNetwork(builder: any, network: MicrosandboxOptions["network"]) {
  if (network === "none") return builder.network((n: any) => n.policy(NetworkPolicy.none()));
  if (network === "allow-all") return builder.network((n: any) => n.policy(NetworkPolicy.allowAll()));
  return builder.network((n: any) => n.policy(NetworkPolicy.publicOnly()));
}

function applyBundledRuntime(builder: any) {
  if (typeof builder.libkrunfwPath !== "function") return builder;
  const libkrunfwPath = resolveBundledLibkrunfwPath();
  return libkrunfwPath ? builder.libkrunfwPath(libkrunfwPath) : builder;
}

async function stopSandbox(sandbox: any): Promise<void> {
  if (typeof sandbox.stopAndWait === "function") await sandbox.stopAndWait();
  else if (typeof sandbox.stop === "function") await sandbox.stop();
  if (typeof sandbox.removePersisted === "function") await sandbox.removePersisted();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMicrosandboxStartError(error: unknown): string {
  const message = formatError(error);
  if (message.includes("libkrunfw not found")) {
    return `${message}. The bundled Microsandbox platform package was installed, but the runtime did not find libkrunfw. Try \`bun node_modules/.bin/microsandbox self install\` once, or set MSB_PATH/libkrunfwPath to a working Microsandbox runtime.`;
  }
  if (message.includes("Operation not permitted")) {
    return `${message}. Microsandbox could not start a microVM with the current host permissions. On macOS this usually means the terminal/app needs virtualization permission or the process is running inside a restricted sandbox; on Linux check KVM access.`;
  }
  return message;
}

function resolveBundledLibkrunfwPath(): string | undefined {
  const triple = platformTriple();
  if (!triple) return undefined;
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve(`@superradcompany/microsandbox-${triple}/package.json`);
    const root = path.dirname(packagePath);
    const name = process.platform === "darwin" ? "libkrunfw.5.dylib" : "libkrunfw.so";
    const candidate = path.join(root, "lib", name);
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function platformTriple(): string | undefined {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-gnu";
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64-gnu";
  return undefined;
}

function toWorkspacePath(sandboxPath: string): string {
  const relativePath = sandboxPath.startsWith("/workspace/")
    ? sandboxPath.slice("/workspace/".length)
    : ensureRelativePath(sandboxPath);
  return sandboxWorkspacePath(relativePath);
}
