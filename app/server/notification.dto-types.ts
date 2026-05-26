import type { NotificationKind } from "../../src/notifications/types";

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  conversationId: string | null;
  actionStatus: "none" | "pending" | "resolved" | "expired";
  actionExpiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface NotificationAttentionItemDto {
  id: string;
  kind: "permission" | "task_failed" | "automation" | "clarification";
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
}

export interface NotificationAttentionDto {
  active: boolean;
  count: number;
  label: string;
  items: NotificationAttentionItemDto[];
}
