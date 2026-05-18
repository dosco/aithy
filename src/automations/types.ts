export type AutomationStatus = "active" | "paused" | "needs_input" | "archived";

export type AutomationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AutomationNotificationPolicy =
  | "always"
  | "attention_only"
  | "failures_only"
  | "silent";

export type AutomationCreatedSource = "chat" | "ui" | "system";

export type AutomationAttentionType = "vigil" | "reminder" | "ritual" | "briefing";

export type AutomationSchedule =
  | {
      kind: "cron";
      pattern: string;
      human: string;
      skipMissed?: boolean;
    }
  | {
      kind: "interval";
      everyMs: number;
      human: string;
      skipMissed?: boolean;
    }
  | {
      kind: "once";
      runAt: string;
      human: string;
    };

export interface AutomationRecord {
  id: string;
  status: AutomationStatus;
  attentionType: AutomationAttentionType;
  title: string;
  prompt: string;
  schedule: AutomationSchedule;
  timezone: string;
  notificationPolicy: AutomationNotificationPolicy;
  originSessionId: string;
  createdSource: AutomationCreatedSource;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRecord {
  id: string;
  automationId: string;
  runSessionId: string | null;
  taskId: string | null;
  status: AutomationRunStatus;
  triggeredAt: string;
  scheduledFor: string;
  resultSummary: string | null;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateAutomationInput {
  attentionType: AutomationAttentionType;
  title: string;
  prompt: string;
  schedule: AutomationSchedule;
  timezone: string;
  notificationPolicy: AutomationNotificationPolicy;
  originSessionId: string;
  createdSource: AutomationCreatedSource;
}

export interface AutomationPatch {
  status?: AutomationStatus;
  attentionType?: AutomationAttentionType;
  title?: string;
  prompt?: string;
  schedule?: AutomationSchedule;
  timezone?: string;
  notificationPolicy?: AutomationNotificationPolicy;
  originSessionId?: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
}

export interface CreateAutomationRunInput {
  automationId: string;
  triggeredAt: string;
  scheduledFor: string;
}

export interface AutomationRunPatch {
  runSessionId?: string | null;
  taskId?: string | null;
  status?: AutomationRunStatus;
  resultSummary?: string | null;
  errorSummary?: string | null;
}
