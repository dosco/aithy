import type { NotificationCreate, NotificationEntry } from "../notifications/types";
import type { SessionManager } from "../session/session-manager";
import { type LiveEventHub, serializableSession } from "../web/live-events";

export interface PostToSubSessionInput {
  parentSessionId: string;
  parentMessageId?: number | null;
  text: string;
  name?: string;
  source?: string;
  notify?: boolean;
}

export function postToSubSession(
  sessions: SessionManager,
  live: LiveEventHub,
  notify: (input: NotificationCreate) => NotificationEntry,
  input: PostToSubSessionInput,
): { sessionId: string; messageId: number | null } {
  const sub = sessions.createSubSession({
    parentSessionId: input.parentSessionId,
    parentMessageId: input.parentMessageId ?? null,
    name: input.name ?? "Sub-session",
    source: input.source,
  });
  sessions.appendMessages(sub.conversationId, [
    {
      role: "assistant",
      kind: "text",
      content: input.text,
      createdAt: new Date().toISOString(),
    },
  ]);
  live.publish({
    type: "sessions",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sessions: sessions.listSessions().map(serializableSession),
  });
  if (input.notify !== false) {
    notify({
      kind: "session.message",
      title: input.name ?? "New message in a sub-session",
      body: input.text.slice(0, 200),
      link: `/chat/${sub.conversationId}`,
    });
  }
  return {
    sessionId: sub.conversationId,
    messageId: sessions.lastMessageId(sub.conversationId),
  };
}
