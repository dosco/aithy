import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
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
  state: "live" | "parked";
}

const RUNNER_SCRIPT = `
import { $ } from "bun";

const input = await new Response(Bun.stdin.stream()).json();
const result = await $\`\${{ raw: input.command }}\`
  .cwd(input.cwd)
  .nothrow()
  .quiet();

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.exitCode);
`;

export class DisabledSandboxProvider implements SandboxProvider {
  readonly sessions = new Map<string, DisabledSandboxEntry>();

  async createSession(
    conversationId: string,
    hostWorkspacePath: string,
    _mounts: SessionMount[],
  ): Promise<SandboxSession> {
    const id = disabledSessionIdFor(conversationId);
    await ensureHostWorkspace(hostWorkspacePath);
    this.sessions.set(id, { hostWorkspacePath, state: "live" });
    return { id, name: id };
  }

  async recreate(
    sessionId: string,
    hostWorkspacePath: string,
    _mounts: SessionMount[],
  ): Promise<SandboxSession> {
    await ensureHostWorkspace(hostWorkspacePath);
    this.sessions.set(sessionId, { hostWorkspacePath, state: "live" });
    return { id: sessionId, name: sessionId };
  }

  async bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult> {
    await this.resume(sessionId);
    const entry = this.getEntry(sessionId);
    const timeoutMs = Math.min(request.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS);
    const cwd = toHostWorkspacePath(entry.hostWorkspacePath, request.cwd ?? "/workspace");
    const result = await runBunShell({
      command: request.command,
      cwd,
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
    const hostPath = this.hostPath(sessionId, sandboxPath);
    const content = await readFile(hostPath, "utf8");
    return content.length > maxBytes ? content.slice(0, maxBytes) : content;
  }

  async write(sessionId: string, sandboxPath: string, content: string): Promise<SandboxFile> {
    await this.resume(sessionId);
    const hostPath = this.hostPath(sessionId, sandboxPath);
    await mkdir(path.dirname(hostPath), { recursive: true });
    await writeFile(hostPath, content, "utf8");
    return { path: toSandboxPath(hostPath, this.getEntry(sessionId).hostWorkspacePath), sizeBytes: Buffer.byteLength(content) };
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
    const entry = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (!entry) return;
    await rm(path.join(entry.hostWorkspacePath, "_cache"), { recursive: true, force: true }).catch(() => undefined);
  }

  private hostPath(sessionId: string, sandboxPath: string): string {
    return toHostWorkspacePath(this.getEntry(sessionId).hostWorkspacePath, sandboxPath);
  }

  private getEntry(sessionId: string): DisabledSandboxEntry {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Disabled sandbox session not found: ${sessionId}`);
    return entry;
  }
}

export function disabledSessionIdFor(conversationId: string): string {
  return `disabled-${conversationId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
}

function toHostWorkspacePath(hostWorkspacePath: string, sandboxPath: string): string {
  if (sandboxPath === "/workspace") return hostWorkspacePath;
  if (sandboxPath.startsWith("/workspace/")) {
    return safeJoin(hostWorkspacePath, sandboxPath.slice("/workspace/".length));
  }
  if (path.isAbsolute(sandboxPath)) {
    throw new Error("Disabled sandbox path must stay under /workspace");
  }
  return safeJoin(hostWorkspacePath, sandboxPath);
}

function toSandboxPath(hostPath: string, hostWorkspacePath: string): string {
  const relativePath = path.relative(hostWorkspacePath, hostPath);
  return `/workspace/${ensureRelativePath(relativePath)}`;
}

async function ensureHostWorkspace(hostWorkspacePath: string): Promise<void> {
  await mkdir(path.join(hostWorkspacePath, "inbox"), { recursive: true });
  await mkdir(path.join(hostWorkspacePath, "out"), { recursive: true });
  await mkdir(path.join(hostWorkspacePath, "mounts"), { recursive: true });
  await mkdir(path.join(hostWorkspacePath, "_cache"), { recursive: true });
}

async function runBunShell(input: {
  command: string;
  cwd: string;
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
    stdin.write(JSON.stringify({ command: input.command, cwd: input.cwd }));
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
