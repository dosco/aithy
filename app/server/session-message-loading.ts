import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import type { MessagePage, MessagePageInput } from "../../src/session/state-store";

const EMPTY_CHILD_RETRY_DELAYS_MS = [25, 75];

type RuntimeSessionState = Pick<AithyRuntime, "sessions" | "sessionState">;

export async function preloadExistingSessionMessagePage(
  runtime: RuntimeSessionState,
  conversationId: string,
  input: MessagePageInput,
): Promise<MessagePage | null> {
  await runtime.sessionState.preloadSession(conversationId);
  const summary = runtime.sessions.getSummary(conversationId);
  if (!summary) return null;

  for (let attempt = 0; ; attempt += 1) {
    await runtime.sessionState.preloadMessages(conversationId, input);
    const page = runtime.sessions.messagesPage(conversationId, input);
    if (page.items.length > 0) return page;
    const delayMs = EMPTY_CHILD_RETRY_DELAYS_MS[attempt];
    if (!summary.parentSessionId || input.beforeId != null || delayMs === undefined) return page;
    await delay(delayMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
