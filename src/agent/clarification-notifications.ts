import type { NotificationCreate, NotificationKind } from "../notifications/types";
import type { AssistantClarification } from "../session/types";

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
  clarification?: AssistantClarification,
): void {
  notify?.({
    kind: "session.clarification",
    title: "Aithy has a question",
    body: notificationBody(question, clarification),
    link: `/chat/${conversationId}`,
    conversationId,
    actionStatus: "pending",
    actionExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  });
}

function notificationBody(question: string, clarification?: AssistantClarification): string {
  const labels = clarification?.choices?.map((choice) => choice.label) ?? [];
  return labels.length ? `${question}\n\nChoices: ${labels.join(", ")}` : question;
}
