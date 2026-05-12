import type { AppConfig } from "../config/env";
import { createAiService } from "./ai-service";

const AI_TEST_TIMEOUT_MS = 20_000;

export async function a(config: AppConfig): Promise<void> {
  if (!config.aiModel?.trim()) throw new Error("AI test failed: missing model.");
  const llm = createAiService(config);
  try {
    await withTimeout(
      llm.chat({
        chatPrompt: [
          {
            role: "user",
            content: "Say hello in one short sentence.",
          },
        ],
      }, {
        timeout: AI_TEST_TIMEOUT_MS,
        stream: false,
      }),
      AI_TEST_TIMEOUT_MS,
    );
  } catch (error) {
    throw new Error(`AI test failed: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown provider error";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`provider did not respond within ${timeoutMs / 1000} seconds`)),
          timeoutMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
