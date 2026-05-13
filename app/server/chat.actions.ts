import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleSlashCommand } from "../../src/commands/slash-commands";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { generateSessionName } from "../../src/session/session-names";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { messageEvent } from "../../src/web/live-events";
import { sendInput, conversationIdInput } from "./action-schemas";
import {
  assistantMessage,
  commandMessage,
  persistedUserMessage,
  publishSessions,
  userMessage,
} from "./action-helpers";
import { tryHandleSkillPromotionReply } from "./skill-promotion-replies";

export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator(sendInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    if (runtime.isShuttingDown() || runtime.isResetting()) {
      const bot = assistantMessage(
        runtime.isResetting()
          ? "Aithy is resetting. Try again in a moment."
          : "Aithy is shutting down. Try again after restart.",
      );
      runtime.live.publish(messageEvent(data.conversationId, bot));
      return { activeSessionId: data.conversationId, queued: false };
    }

    const text = data.text.trim();
    const user = userMessage(data.conversationId, text, new Date(data.createdAt));
    try {
      runtime.sessions.ensureLogicalSession(data.conversationId, {
        name: generateSessionName(text),
        nameSource: "generated",
      });
      await runtime.sessionState.flush();
      runtime.settings.save({ ui: { lastActiveSessionId: data.conversationId } });

      if (text.startsWith("/")) return handleCommand(runtime, data.conversationId, text);
      const promotionReply = tryHandleSkillPromotionReply({ runtime, user, publishSessions });
      if (promotionReply) {
        await runtime.sessionState.flush();
        return { activeSessionId: data.conversationId, queued: false };
      }

      runtime.sessions.appendMessages(data.conversationId, [persistedUserMessage(user)]);
      await runtime.sessionState.flush();
      runtime.assertReady();
      const queued = await runtime.dispatcher.enqueueUserChat({
        conversationId: data.conversationId,
        text: user.text,
        createdAt: user.createdAt.toISOString(),
        skillIds: data.skillIds ?? [],
      });
      return { activeSessionId: data.conversationId, queued: true, jobId: queued.jobId };
    } catch (error) {
      const bot = assistantMessage(error instanceof Error ? `Error: ${error.message}` : "Unknown error");
      runtime.sessions.appendMessages(data.conversationId, [bot]);
      try {
        await runtime.sessionState.flush();
      } catch {
        runtime.live.publish(messageEvent(data.conversationId, bot));
      }
      return { activeSessionId: data.conversationId, queued: false };
    }
  });

export const stopChatMessage = createServerFn({ method: "POST" })
  .inputValidator(conversationIdInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const dropped = await runtime.dispatcher.cancelByConversation(data.conversationId);
    return { stopped: true, queuedDropped: dropped };
  });

async function handleCommand(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  conversationId: string,
  text: string,
) {
  const result = await handleSlashCommand(commandMessage(conversationId, text), {
    sessions: runtime.sessions,
  });
  if (result.activeConversationId) {
    runtime.settings.save({ ui: { lastActiveSessionId: result.activeConversationId } });
  }
  const reply = assistantMessage(result.reply.text);
  runtime.live.publish(messageEvent(result.reply.conversationId, reply));
  await runtime.sessionState.flush();
  publishSessions(runtime);
  return {
    activeSessionId: result.activeConversationId ?? conversationId,
    queued: false,
  };
}
