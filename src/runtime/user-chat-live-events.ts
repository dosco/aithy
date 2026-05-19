import type { UserChatJobData, UserChatJobResult } from "../agent/dispatcher";
import { userFacingErrorText } from "../agent/error-copy";
import type { SessionManager } from "../session/session-manager";
import type { AssistantTextMessage } from "../session/types";

interface UserChatLiveRuntime {
  sessions: SessionManager;
}

export function publishUserChatReply(
  _runtime: UserChatLiveRuntime,
  _result: UserChatJobResult,
): void {
}

export function publishUserChatFailure(
  runtime: UserChatLiveRuntime,
  data: UserChatJobData,
  error: Error,
): void {
  const assistant = assistantMessage(userFacingErrorText(error), "failed");
  runtime.sessions.appendMessages(data.conversationId, [assistant]);
}

function assistantMessage(
  text: string,
  status?: AssistantTextMessage["status"],
  createdAt = new Date().toISOString(),
): AssistantTextMessage {
  return {
    role: "assistant",
    kind: "text",
    content: text,
    ...(status ? { status } : {}),
    createdAt,
  };
}
