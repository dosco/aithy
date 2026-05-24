import { mkdir } from "node:fs/promises";
import path from "node:path";
import { NetworkPolicy, Sandbox } from "microsandbox";
import { INTERNAL_SANDBOX_IMAGES } from "./image-catalog";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  MAX_SANDBOX_INLINE_BYTES,
  MAX_TOOL_OUTPUT_CHARS
} from "../config/limits";
import { ensureRelativePath } from "../workspace/safe-path";
import {
  activeStatus,
  createPullProgressTracker,
  failedStatus,
  type PullProgressEventLike,
  type SetupStatusInput,
} from "../setup/status";
import { trimOutput } from "./command";
import {
  applyBundledRuntime,
  formatError,
  formatMicrosandboxStartError,
  stopSandbox,
  type MicrosandboxBuilder,
  type MicrosandboxFactory,
  type MicrosandboxFs,
  type MicrosandboxInstance,
} from "./microsandbox-sdk";
import { sandboxNameFor } from "./sandbox-name";
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
  sandboxFactory?: MicrosandboxFactory;
  onStatus?: (status: SetupStatusInput) => void;
}

type SandboxState = "live" | "parked";

interface SandboxEntry {
  sandbox: MicrosandboxInstance | null;
  hostWorkspacePath: string;
  hostOutboxPath: string;
  mounts: SessionMount[];
  state: SandboxState;
}

export class MicrosandboxProvider implements SandboxProvider {
  private readonly sandboxes = new Map<string, SandboxEntry>();

  constructor(private readonly options: MicrosandboxOptions) {}

  async createSession(
    botId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    maybeMounts?: SessionMount[]
  ): Promise<SandboxSession> {
    const name = sandboxNameFor(botId);
    const { hostOutboxPath, mounts } = outboxAndMounts(hostWorkspacePath, hostOutboxPathOrMounts, maybeMounts);
    await ensureHostPath(hostWorkspacePath);
    await ensureHostPath(hostOutboxPath);
    const sandbox = await this.createSandbox(name, hostWorkspacePath, hostOutboxPath, mounts);
    this.sandboxes.set(name, { sandbox, hostWorkspacePath, hostOutboxPath, mounts: [...mounts], state: "live" });
    return { id: name, name };
  }

  async recreate(
    sessionId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    maybeMounts?: SessionMount[]
  ): Promise<SandboxSession> {
    const { hostOutboxPath, mounts } = outboxAndMounts(hostWorkspacePath, hostOutboxPathOrMounts, maybeMounts);
    const existing = this.sandboxes.get(sessionId);
    if (existing) {
      this.sandboxes.delete(sessionId);
      if (existing.state === "live" && existing.sandbox) await stopSandbox(existing.sandbox);
    }
    await ensureHostPath(hostWorkspacePath);
    await ensureHostPath(hostOutboxPath);
    const sandbox = await this.createSandbox(sessionId, hostWorkspacePath, hostOutboxPath, mounts);
    this.sandboxes.set(sessionId, { sandbox, hostWorkspacePath, hostOutboxPath, mounts: [...mounts], state: "live" });
    return { id: sessionId, name: sessionId };
  }

  async bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult> {
    await this.ensureLive(sessionId);
    const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS);
    const cwd = normalizeSandboxCwd(request.cwd);
    const command = `${envExports(request.env)}cd ${shellQuote(cwd)} && ${request.command}`;

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
    const safeSandboxPath = toSandboxFilePath(sandboxPath);
    const content = await this.fs(sessionId).readToString(safeSandboxPath);
    return content.length > maxBytes ? content.slice(0, maxBytes) : content;
  }

  async write(sessionId: string, sandboxPath: string, content: string): Promise<SandboxFile> {
    await this.ensureLive(sessionId);
    const safeSandboxPath = toSandboxFilePath(sandboxPath);
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
    const sandbox = this.getLiveSandbox(sessionId);
    if (typeof sandbox.stopAndWait === "function") await sandbox.stopAndWait();
    else if (typeof sandbox.stop === "function") await sandbox.stop();
    entry.state = "parked";
    entry.sandbox = null;
  }

  async resume(sessionId: string): Promise<void> {
    const entry = this.sandboxes.get(sessionId);
    if (!entry) throw new Error(`Microsandbox session not found: ${sessionId}`);
    if (entry.state === "live" && entry.sandbox) return;
    const factory = this.factory();
    if (typeof factory.get !== "function") {
      // SDK does not expose Sandbox.get — rebuild from scratch using the same builder pipeline.
      entry.sandbox = await this.createSandbox(sessionId, entry.hostWorkspacePath, entry.hostOutboxPath, entry.mounts);
      entry.state = "live";
      return;
    }
    try {
      const handle = await factory.get(sessionId);
      entry.sandbox = await handle.startDetached();
    } catch {
      // No persisted record (or it was lost) — build a fresh VM with the same configuration.
      entry.sandbox = await this.createSandbox(sessionId, entry.hostWorkspacePath, entry.hostOutboxPath, entry.mounts);
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
      const factory = this.factory();
      if (typeof factory.remove === "function") {
        await factory.remove(sessionId).catch(() => undefined);
      }
    }
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
    hostOutboxPath: string,
    mounts: SessionMount[]
  ): Promise<MicrosandboxInstance> {
    const factory = this.factory();
    if (!factory?.builder) throw new Error("Microsandbox SDK does not expose Sandbox.builder(...). Install a local no-key microsandbox package.");

    try {
      return await this.createSandboxWithFallback(factory, name, hostWorkspacePath, hostOutboxPath, mounts);
    } catch (error) {
      const message = formatMicrosandboxStartError(error);
      this.options.onStatus?.(failedStatus("sandbox", `sandbox failed: ${message}`));
      throw new Error(`Failed to start Microsandbox microVM: ${message}`);
    }
  }

  private async createSandboxWithFallback(
    factory: MicrosandboxFactory,
    name: string,
    hostWorkspacePath: string,
    hostOutboxPath: string,
    mounts: SessionMount[],
  ): Promise<MicrosandboxInstance> {
    try {
      return await this.createSandboxFromImage(factory, this.options.image, name, hostWorkspacePath, hostOutboxPath, mounts);
    } catch (error) {
      const fallbackImage = internalImageFallbackFor(this.options.image, error);
      if (!fallbackImage) throw error;
      this.options.onStatus?.(activeStatus("sandbox", `sandbox image tag missing; retrying ${fallbackImage}`));
      return this.createSandboxFromImage(factory, fallbackImage, name, hostWorkspacePath, hostOutboxPath, mounts);
    }
  }

  private async createSandboxFromImage(
    factory: MicrosandboxFactory,
    image: string,
    name: string,
    hostWorkspacePath: string,
    hostOutboxPath: string,
    mounts: SessionMount[],
  ): Promise<MicrosandboxInstance> {
    let builder = factory.builder(name).image(image).cpus(this.options.cpus).memory(this.options.memoryMb).replace();
    builder = enablePublicGhcrPull(builder, image);
    builder = applyBundledRuntime(builder);
    builder = applyNetwork(builder, this.options.network);
    builder = builder.volume("/workspace", (v) => v.bind(hostWorkspacePath));
    builder = builder.volume("/outbox", (v) => v.bind(hostOutboxPath));
    for (const mount of mounts) {
      builder = builder.volume(`/mounts/${mount.mountName}`, (v) => v.bind(mount.hostPath));
    }
    return this.createFromBuilder(builder, image);
  }

  private async createFromBuilder(builder: MicrosandboxBuilder, image: string): Promise<MicrosandboxInstance> {
    this.options.onStatus?.(activeStatus("sandbox", `starting sandbox image ${image}`));
    if (typeof builder.createWithPullProgress !== "function") {
      return builder.create();
    }
    const created = await builder.createWithPullProgress();
    const progressDone = this.consumePullProgress(created.progress, image);
    try {
      const sandbox = await created.awaitSandbox();
      await progressDone.catch(() => undefined);
      return sandbox;
    } catch (error) {
      await progressDone.catch(() => undefined);
      throw error;
    }
  }

  private async consumePullProgress(progress: AsyncIterable<PullProgressEventLike>, image: string): Promise<void> {
    const statusFor = createPullProgressTracker(image);
    for await (const event of progress) {
      this.options.onStatus?.(statusFor(event));
    }
    this.options.onStatus?.(activeStatus("sandbox", `starting sandbox image ${image}`));
  }

  private async execWithTimeout(sessionId: string, cmd: string, args: string[], timeoutMs: number) {
    const sandbox = this.getLiveSandbox(sessionId);
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

  private fs(sessionId: string): MicrosandboxFs {
    return this.getLiveSandbox(sessionId).fs();
  }

  private getEntry(sessionId: string): SandboxEntry {
    const entry = this.sandboxes.get(sessionId);
    if (!entry) throw new Error(`Microsandbox session not found: ${sessionId}`);
    return entry;
  }

  private getLiveSandbox(sessionId: string): MicrosandboxInstance {
    const entry = this.getEntry(sessionId);
    if (!entry.sandbox) throw new Error(`Microsandbox session is not live: ${sessionId}`);
    return entry.sandbox;
  }

  private factory(): MicrosandboxFactory {
    return (this.options.sandboxFactory ?? Sandbox) as MicrosandboxFactory;
  }
}

function enablePublicGhcrPull(builder: MicrosandboxBuilder, image: string): MicrosandboxBuilder {
  if (!isAithyGhcrImage(image) || typeof builder.registry !== "function") return builder;
  // Microsandbox calls this "anonymous" registry auth; it is the no-credentials public pull mode.
  return builder.registry((registry) => registry.auth({ kind: "anonymous" })) ?? builder;
}

function isAithyGhcrImage(image: string): boolean {
  const value = image.trim().toLowerCase();
  return INTERNAL_SANDBOX_IMAGES.some((entry) => {
    const repository = entry.repository.toLowerCase();
    return value === repository || value.startsWith(`${repository}:`) || value.startsWith(`${repository}@`);
  });
}

function internalImageFallbackFor(image: string, error: unknown): string | undefined {
  if (!/manifest unknown|name unknown|not found|404/i.test(formatError(error))) return undefined;
  const value = image.trim();
  const entry = INTERNAL_SANDBOX_IMAGES.find((item) => value.toLowerCase().startsWith(`${item.repository.toLowerCase()}:`));
  if (!entry) return undefined;
  const tag = value.slice(entry.repository.length + 1);
  return /^(latest|v[0-9][^:]*?)-(amd64|arm64)$/.test(tag) ? `${entry.repository}:latest` : undefined;
}

async function ensureHostPath(hostPath: string): Promise<void> {
  await mkdir(hostPath, { recursive: true });
}

function applyNetwork(builder: MicrosandboxBuilder, network: MicrosandboxOptions["network"]) {
  if (network === "none") return builder.network((n) => n.policy(NetworkPolicy.none()));
  if (network === "allow-all") return builder.network((n) => n.policy(NetworkPolicy.allowAll()));
  return builder.network((n) => n.policy(NetworkPolicy.publicOnly()));
}

function outboxAndMounts(
  hostWorkspacePath: string,
  hostOutboxPathOrMounts: string | SessionMount[],
  maybeMounts?: SessionMount[],
): { hostOutboxPath: string; mounts: SessionMount[] } {
  if (typeof hostOutboxPathOrMounts === "string") {
    return { hostOutboxPath: hostOutboxPathOrMounts, mounts: maybeMounts ?? [] };
  }
  return { hostOutboxPath: path.join(hostWorkspacePath, "outbox"), mounts: hostOutboxPathOrMounts };
}

function toSandboxFilePath(sandboxPath: string): string {
  if (sandboxPath === "/workspace") return "/workspace";
  if (sandboxPath.startsWith("/workspace/")) {
    return sandboxWorkspacePath(sandboxPath.slice("/workspace/".length));
  }
  if (sandboxPath === "/outbox") return "/outbox";
  if (sandboxPath.startsWith("/outbox/")) {
    return `/outbox/${ensureRelativePath(sandboxPath.slice("/outbox/".length))}`;
  }
  return sandboxWorkspacePath(ensureRelativePath(sandboxPath));
}

function envExports(env: Record<string, string> | undefined): string {
  if (!env) return "";
  const entries = Object.entries(env)
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    .map(([key, value]) => `export ${key}=${shellQuote(value)}; `);
  return entries.join("");
}
