export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runCommand(args: string[], timeoutMs: number): Promise<CommandResult> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe"
    });
  } catch (error) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Failed to spawn command",
      timedOut: false
    };
  }

  let didTimeOut = false;
  const timeout = setTimeout(() => {
    didTimeOut = true;
    proc.kill();
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    proc.exited
  ]).finally(() => clearTimeout(timeout));

  return {
    exitCode,
    stdout,
    stderr,
    timedOut: didTimeOut
  };
}

export function trimOutput(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const hidden = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n[${hidden} chars truncated]`;
}

async function streamText(stream: unknown): Promise<string> {
  if (!stream || typeof stream === "number") return "";
  return new Response(stream as BodyInit).text();
}
