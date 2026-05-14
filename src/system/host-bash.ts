import { trimOutput } from "../sandbox/command";
import type { SandboxBashResult } from "../sandbox/provider";

export interface HostBashRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
}

export async function runHostBash(request: HostBashRequest): Promise<SandboxBashResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["bash", "-lc", request.command], {
      cwd: request.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Failed to spawn host bash",
      timedOut: false,
    };
  }

  let didTimeOut = false;
  const timer = setTimeout(() => {
    didTimeOut = true;
    proc.kill();
  }, request.timeoutMs);
  timer.unref();

  const [stdout, stderr, exitCode] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    proc.exited,
  ]).finally(() => clearTimeout(timer));

  return {
    exitCode: didTimeOut ? 124 : exitCode,
    stdout: trimOutput(stdout, request.maxOutputChars),
    stderr: trimOutput(
      didTimeOut ? `Command timed out after ${request.timeoutMs}ms` : stderr,
      request.maxOutputChars,
    ),
    timedOut: didTimeOut,
  };
}

async function streamText(stream: unknown): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return new Response(stream as BodyInit).text();
}
