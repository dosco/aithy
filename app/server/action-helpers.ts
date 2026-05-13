import type { ChannelCommand, ChannelMessage } from "../../src/channel/types";
import type { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import type { UserMessage } from "../../src/session/types";
import { sessionDto } from "./dto";

export type WebRuntime = Awaited<ReturnType<typeof getAithyRuntime>>;

export function publishSessions(runtime: WebRuntime): void {
  runtime.live.publish({
    type: "sessions",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sessions: runtime.sessions.listSessions().map(sessionDto),
  });
}

export function userMessage(conversationId: string, text: string, createdAt = new Date()): ChannelMessage {
  return {
    id: crypto.randomUUID(),
    channelId: "web",
    conversationId,
    senderId: "local-user",
    text,
    createdAt,
  };
}

export function commandMessage(conversationId: string, text: string): ChannelCommand {
  return {
    ...userMessage(conversationId, text),
    kind: "command",
  };
}

export function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    kind: "text" as const,
    content: text,
    createdAt: new Date().toISOString(),
  };
}

export function persistedUserMessage(message: ChannelMessage): UserMessage {
  return {
    role: "user",
    content: message.text,
    createdAt: message.createdAt.toISOString(),
  };
}
