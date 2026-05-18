import type { AutomationAttentionType, AutomationNotificationPolicy, AutomationRecord } from "./types";

export interface AutomationCreateRequest {
  attentionType?: AutomationAttentionType;
  title: string;
  prompt: string;
  scheduleKind: string;
  time?: string;
  dayOfWeek?: string;
  everyMinutes?: number;
  cronPattern?: string;
  runAt?: string;
  human?: string;
  timezone?: string;
  notificationPolicy?: AutomationNotificationPolicy;
  originSessionId: string;
  createdSource: "chat" | "ui" | "system";
}

export interface AutomationToolActions {
  create(input: AutomationCreateRequest): Promise<AutomationRecord>;
  list(originSessionId?: string): AutomationRecord[];
  pause(id: string): Promise<AutomationRecord | null>;
  resume(id: string): Promise<AutomationRecord | null>;
  archive(id: string): Promise<AutomationRecord | null>;
  runNow(id: string): Promise<void>;
}
