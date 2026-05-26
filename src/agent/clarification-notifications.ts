import type { NotificationCreate, NotificationKind } from "../notifications/types";

export type NotificationActionResolver = (input: {
  conversationId: string;
  kinds?: readonly NotificationKind[];
}) => void;

export function resolveClarificationNotifications(
  resolve: NotificationActionResolver | undefined,
  conversationId: string,
): void {
  resolve?.({
    conversationId,
    kinds: ["session.clarification"],
  });
}

export function notifyClarification(
  notify: ((input: NotificationCreate) => void) | undefined,
  conversationId: string,
  question: string,
): void {
  notify?.({
    kind: "session.clarification",
    title: "Aithy has a question",
    body: question,
    link: `/chat/${conversationId}`,
    conversationId,
    actionStatus: "pending",
    actionExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });
}
