import type { UserChatJobData, UserChatJobResult } from "../agent/dispatcher";
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
  const assistant = assistantMessage(`Error: ${error.message}`, new Date().toISOString(), data.responseRunId);
  runtime.sessions.appendMessages(data.conversationId, [assistant]);
}

function assistantMessage(
  text: string,
  createdAt = new Date().toISOString(),
  runId?: string,
): AssistantTextMessage {
  return {
    role: "assistant",
    kind: "text",
    content: text,
    ...(runId ? { runId } : {}),
    createdAt,
  };
}
