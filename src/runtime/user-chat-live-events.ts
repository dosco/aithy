import type { UserChatJobData, UserChatJobResult } from "../agent/dispatcher";
import type { LiveEventHub } from "../web/live-events";
import { messageEvent, serializableSession } from "../web/live-events";
import type { SessionManager } from "../session/session-manager";
import type { AssistantTextMessage } from "../session/types";

interface UserChatLiveRuntime {
  live: LiveEventHub;
  sessions: SessionManager;
}

export function publishUserChatReply(
  runtime: UserChatLiveRuntime,
  result: UserChatJobResult,
): void {
  runtime.live.publish(messageEvent(
    result.conversationId,
    assistantMessage(result.text, result.createdAt),
  ));
  publishSessions(runtime);
}

export function publishUserChatFailure(
  runtime: UserChatLiveRuntime,
  data: UserChatJobData,
  error: Error,
): void {
  const assistant = assistantMessage(`Error: ${error.message}`);
  runtime.sessions.appendMessages(data.conversationId, [assistant]);
  runtime.live.publish(messageEvent(data.conversationId, assistant));
  publishSessions(runtime);
}

function assistantMessage(text: string, createdAt = new Date().toISOString()): AssistantTextMessage {
  return {
    role: "assistant",
    kind: "text",
    content: text,
    createdAt,
  };
}

function publishSessions(runtime: UserChatLiveRuntime): void {
  runtime.live.publish({
    type: "sessions",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sessions: runtime.sessions.listSessions().map(serializableSession),
  });
}
