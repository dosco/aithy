import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { handleSlashCommand } from "../../src/commands/slash-commands";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { generateSessionName } from "../../src/session/session-names";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { messageEvent } from "../../src/web/live-events";
import { taskStatusEvent } from "../../src/tasks/live";
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
    let taskId: string | null = null;
    try {
      runtime.sessions.ensureLogicalSession(data.conversationId, {
        name: generateSessionName(text),
        nameSource: "generated",
      });
      await runtime.sessionState.flush();
      runtime.settings.save({ ui: { lastActiveSessionId: data.conversationId } });

      if (text.startsWith("/")) return handleCommand(runtime, data.conversationId, text);
      const promotionReply = await tryHandleSkillPromotionReply({ runtime, user, publishSessions });
      if (promotionReply) {
        await runtime.sessionState.flush();
        return { activeSessionId: data.conversationId, queued: false };
      }

      runtime.sessions.appendMessages(data.conversationId, [persistedUserMessage(user)]);
      await runtime.sessionState.flush();
      runtime.assertReady();
      const task = runtime.tasks.create({
        kind: "chat.turn",
        title: taskTitle(user.text),
        conversationId: data.conversationId,
        relatedSessionId: data.conversationId,
        reason: "Queued for agent",
        metadata: { text: user.text, skillIds: data.skillIds ?? [] },
      });
      taskId = task.id;
      runtime.live.publish(taskStatusEvent(task));
      const queued = await runtime.dispatcher.enqueueUserChat({
        conversationId: data.conversationId,
        text: user.text,
        createdAt: user.createdAt.toISOString(),
        skillIds: data.skillIds ?? [],
        taskId: task.id,
      });
      const linked = runtime.tasks.update(task.id, {
        queueJobId: queued.jobId,
        reason: "Queued for agent",
      });
      if (linked) runtime.live.publish(taskStatusEvent(linked));
      return { activeSessionId: data.conversationId, queued: true, jobId: queued.jobId, taskId: task.id };
    } catch (error) {
      if (taskId) {
        const failed = runtime.tasks.update(taskId, {
          status: "failed",
          reason: "Could not queue task",
          errorSummary: error instanceof Error ? error.message : String(error),
        });
        if (failed) runtime.live.publish(taskStatusEvent(failed));
      }
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
    for (const task of runtime.tasks.activeForConversation(data.conversationId)) {
      const cancelled = runtime.tasks.update(task.id, {
        status: "cancelled",
        reason: "Stopped by user",
      });
      if (cancelled) runtime.live.publish(taskStatusEvent(cancelled));
    }
    return { stopped: true, queuedDropped: dropped };
  });

function taskTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean || "Chat task";
}

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
