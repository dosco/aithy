import type { AppConfig } from "../config/env";
import { createAiService } from "./ai-service";

export async function a(config: AppConfig): Promise<void> {
  if (!config.aiModel?.trim()) throw new Error("AI test failed: missing model.");
  const llm = createAiService(config);
  try {
    await llm.chat({
      chatPrompt: [
        {
          role: "user",
          content: "Say hello in one short sentence.",
        },
      ],
    }, {
      timeout: 20_000,
      stream: false,
    });
  } catch (error) {
    throw new Error(`AI test failed: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown provider error";
}
