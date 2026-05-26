import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_EXTENDED_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  MAX_LONG_BASH_TIMEOUT_MS,
  MAX_SANDBOX_INLINE_BYTES,
  MAX_TOOL_OUTPUT_CHARS
} from "../config/limits";
import { ensureRelativePath, safeJoin } from "../workspace/safe-path";
import { trimOutput } from "./command";
import type {
  SandboxBashRequest,
  SandboxBashResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
  SessionMount
} from "./provider";

interface DisabledSandboxEntry {
  hostWorkspacePath: string;
  hostOutboxPath: string;
  mounts: SessionMount[];
  state: "live" | "parked";
}

const RUNNER_SCRIPT = `
import { $ } from "bun";

const input = await new Response(Bun.stdin.stream()).json();
const result = await $\`\${{ raw: input.command }}\`
  .cwd(input.cwd)
  .env(input.env ?? {})
  .nothrow()
  .quiet();

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
`;

export class DisabledSandboxProvider implements SandboxProvider {
  readonly sessions = new Map<string, DisabledSandboxEntry>();

  async createSession(
    botId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    maybeMounts?: SessionMount[],
  ): Promise<SandboxSession> {
    const id = disabledSessionIdFor(botId);
    const { hostOutboxPath, mounts } = outboxAndMounts(hostWorkspacePath, hostOutboxPathOrMounts, maybeMounts);
    await ensureHostPath(hostWorkspacePath);
    await ensureHostPath(hostOutboxPath);
    this.sessions.set(id, { hostWorkspacePath, hostOutboxPath, mounts: [...mounts], state: "live" });
    return { id, name: id };
  }

  async recreate(
    sessionId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    maybeMounts?: SessionMount[],
  ): Promise<SandboxSession> {
    const { hostOutboxPath, mounts } = outboxAndMounts(hostWorkspacePath, hostOutboxPathOrMounts, maybeMounts);
    await ensureHostPath(hostWorkspacePath);
    await ensureHostPath(hostOutboxPath);
    this.sessions.set(sessionId, { hostWorkspacePath, hostOutboxPath, mounts: [...mounts], state: "live" });
    return { id: sessionId, name: sessionId };
  }

  async bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult> {
    await this.resume(sessionId);
    const entry = this.getEntry(sessionId);
    const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, timeoutLimitFor(request.timeoutProfile));
    const cwd = toHostPath(entry, request.cwd ?? "/workspace");
    const result = await runBunShell({
      command: request.command,
      cwd,
      env: request.env,
      timeoutMs,
    });
    const maxChars = request.maxOutputChars ?? MAX_TOOL_OUTPUT_CHARS;
    return {
      exitCode: result.exitCode,
      stdout: trimOutput(result.stdout, maxChars),
      stderr: trimOutput(result.stderr, maxChars),
      timedOut: result.timedOut,
    };
  }

  async read(sessionId: string, sandboxPath: string, maxBytes = MAX_SANDBOX_INLINE_BYTES): Promise<string> {
    await this.resume(sessionId);
    const entry = this.getEntry(sessionId);
    const hostPath = toHostPath(entry, sandboxPath);
    const content = await readFile(hostPath, "utf8");
    return content.length > maxBytes ? content.slice(0, maxBytes) : content;
  }

  async write(sessionId: string, sandboxPath: string, content: string): Promise<SandboxFile> {
    await this.resume(sessionId);
    const entry = this.getEntry(sessionId);
    assertWritableSandboxPath(entry, sandboxPath);
    const hostPath = toHostPath(entry, sandboxPath);
    await mkdir(path.dirname(hostPath), { recursive: true });
    await writeFile(hostPath, content, "utf8");
    return { path: toSandboxPath(entry, hostPath), sizeBytes: Buffer.byteLength(content) };
  }

  async edit(sessionId: string, sandboxPath: string, search: string, replace: string): Promise<SandboxFile> {
    const text = await this.read(sessionId, sandboxPath, MAX_SANDBOX_INLINE_BYTES);
    const index = text.indexOf(search);
    if (index === -1) throw new Error("Search text not found in sandbox file");
    const updated = `${text.slice(0, index)}${replace}${text.slice(index + search.length)}`;
    return this.write(sessionId, sandboxPath, updated);
  }

  async park(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.state = "parked";
  }

  async resume(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Disabled sandbox session not found: ${sessionId}`);
    entry.state = "live";
  }

  async destroy(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  private getEntry(sessionId: string): DisabledSandboxEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Disabled sandbox session not found: ${sessionId}`);
    return entry;
  }
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

export function disabledSessionIdFor(botId: string): string {
  return `disabled-${botId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
}

function toHostPath(entry: DisabledSandboxEntry, sandboxPath: string): string {
  if (sandboxPath === "/workspace") return entry.hostWorkspacePath;
  if (sandboxPath.startsWith("/workspace/")) {
    return safeJoin(entry.hostWorkspacePath, sandboxPath.slice("/workspace/".length));
  }
  if (sandboxPath === "/outbox") return entry.hostOutboxPath;
  if (sandboxPath.startsWith("/outbox/")) {
    return safeJoin(entry.hostOutboxPath, sandboxPath.slice("/outbox/".length));
  }
  if (sandboxPath === "/mounts" || sandboxPath.startsWith("/mounts/")) {
    const rest = sandboxPath === "/mounts" ? "" : sandboxPath.slice("/mounts/".length);
    const [name, ...tail] = rest.split("/");
    if (!name) throw new Error("Disabled sandbox /mounts path missing mount name");
    const mount = entry.mounts.find((m) => m.mountName === name);
    if (!mount) throw new Error(`Disabled sandbox mount not found: ${name}`);
    return tail.length === 0 ? mount.hostPath : safeJoin(mount.hostPath, tail.join("/"));
  }
  if (path.isAbsolute(sandboxPath)) {
    throw new Error("Disabled sandbox path must stay under /workspace, /outbox, or /mounts");
  }
  return safeJoin(entry.hostWorkspacePath, sandboxPath);
}

function assertWritableSandboxPath(entry: DisabledSandboxEntry, sandboxPath: string): void {
  const mount = mountForSandboxPath(entry, sandboxPath);
  if (mount && mount.mode !== "read-write") {
    throw new Error(`Mount is read-only: /mounts/${mount.mountName}`);
  }
}

function mountForSandboxPath(entry: DisabledSandboxEntry, sandboxPath: string): SessionMount | undefined {
  if (sandboxPath === "/mounts") throw new Error("Cannot write the /mounts root");
  if (!sandboxPath.startsWith("/mounts/")) return undefined;
  const name = sandboxPath.slice("/mounts/".length).split("/")[0];
  return entry.mounts.find((m) => m.mountName === name);
}

function toSandboxPath(entry: DisabledSandboxEntry, hostPath: string): string {
  const mount = entry.mounts
    .map((item) => ({ item, relative: path.relative(item.hostPath, hostPath) }))
    .find(({ relative }) => !relative.startsWith("..") && !path.isAbsolute(relative));
  if (mount) {
    return mount.relative ? `/mounts/${mount.item.mountName}/${ensureRelativePath(mount.relative)}` : `/mounts/${mount.item.mountName}`;
  }
  const outboxRelativePath = path.relative(entry.hostOutboxPath, hostPath);
  if (outboxRelativePath && !outboxRelativePath.startsWith("..") && !path.isAbsolute(outboxRelativePath)) {
    return `/outbox/${ensureRelativePath(outboxRelativePath)}`;
  }
  const relativePath = path.relative(entry.hostWorkspacePath, hostPath);
  return `/workspace/${ensureRelativePath(relativePath)}`;
}

function timeoutLimitFor(profile: SandboxBashRequest["timeoutProfile"]): number {
  if (profile === "extended") return MAX_EXTENDED_BASH_TIMEOUT_MS;
  if (profile === "long") return MAX_LONG_BASH_TIMEOUT_MS;
  return MAX_BASH_TIMEOUT_MS;
}

async function ensureHostPath(hostPath: string): Promise<void> {
  await mkdir(hostPath, { recursive: true });
}

async function runBunShell(input: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
}): Promise<SandboxBashResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([process.execPath, "--eval", RUNNER_SCRIPT], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Failed to spawn Bun shell",
      timedOut: false,
    };
  }

  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    proc.kill();
  }, input.timeoutMs);
  timer.unref();

  try {
    const stdin = proc.stdin as { write: (chunk: string) => void; end: () => void };
    stdin.write(JSON.stringify({ command: input.command, cwd: input.cwd, env: input.env ?? {} }));
    stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([
      streamText(proc.stdout),
      streamText(proc.stderr),
      proc.exited,
    ]);
    return {
      exitCode: didTimeOut ? 124 : exitCode,
      stdout,
      stderr: didTimeOut ? `Command timed out after ${input.timeoutMs}ms` : stderr,
      timedOut: didTimeOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function streamText(stream: unknown): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return new Response(stream as BodyInit).text();
}
