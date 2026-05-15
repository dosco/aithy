import type { ChatMessageItem } from "@/components/chat-timeline";
import type { SerializableBotMessage } from "../../src/web/live-events";

export function appendUnique(
  messages: ChatMessageItem[],
  next: ChatMessageItem,
): ChatMessageItem[] {
  const exists = messages.some(({ message }) =>
    message.role === next.message.role
    && message.createdAt === next.message.createdAt
    && contentOf(message) === contentOf(next.message)
  );
  return exists ? messages : [...messages, next];
}

export function prependUnique(
  messages: ChatMessageItem[],
  previous: ChatMessageItem[],
): ChatMessageItem[] {
  const currentIds = new Set(messages.map((message) => message.id));
  return [
    ...previous.filter((message) => !currentIds.has(message.id)),
    ...messages,
  ];
}

function contentOf(message: SerializableBotMessage): string {
  if (message.role === "user") return message.content;
  if (message.kind === "text") return message.content;
  if (message.kind === "permission") return `${message.requestId}:${message.status}`;
  if (message.kind === "artifact") return `artifact:${message.id}`;
  return `${message.toolName}:${JSON.stringify(message.toolArgs)}`;
}
