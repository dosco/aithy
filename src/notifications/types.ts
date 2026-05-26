export type NotificationKind =
  | "memory.written"
  | "memory.consolidated"
  | "memory.failed"
  | "session.message"
  | "session.clarification"
  | "skill.suggested"
  | "task.failed"
  | "automation.completed"
  | "automation.needs_attention"
  | "automation.failed"
  | "mount.added"
  | "info";

export type NotificationActionStatus = "none" | "pending" | "resolved" | "expired";

export interface NotificationEntry {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  conversationId: string | null;
  actionStatus: NotificationActionStatus;
  actionExpiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface NotificationCreate {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  conversationId?: string | null;
  actionStatus?: NotificationActionStatus;
  actionExpiresAt?: string | null;
}
