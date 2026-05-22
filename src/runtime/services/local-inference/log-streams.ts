import type { QueueServiceClient } from "../queue/client";

export async function captureLines(
  queue: QueueServiceClient,
  stream: ReadableStream<Uint8Array> | null,
  source: "stdout" | "stderr",
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) recordLine(queue, source, line);
    }
    pending += decoder.decode();
    if (pending.trim()) recordLine(queue, source, pending);
  } catch {}
}

export function streamOrNull(value: unknown): ReadableStream<Uint8Array> | null {
  return value && typeof value === "object" && "getReader" in value
    ? value as ReadableStream<Uint8Array>
    : null;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordLine(queue: QueueServiceClient, source: "stdout" | "stderr", line: string): void {
  const message = line.trimEnd();
  if (!message) return;
  void queue.appendLog({
    role: "local-inference-worker",
    level: source === "stderr" ? "error" : "info",
    source: `llama-${source}`,
    message,
  });
}
