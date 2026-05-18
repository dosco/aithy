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

export interface NotificationEntry {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationCreate {
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
}
