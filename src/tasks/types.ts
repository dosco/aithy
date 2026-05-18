export type TaskStatus =
  | "planned"
  | "running"
  | "paused_approval"
  | "failed"
  | "completed"
  | "cancelled";

export type TaskKind =
  | "chat.turn"
  | "memory.auto"
  | "memory.explicit"
  | "memory.consolidate"
  | "memory.expiry"
  | "memory.dream"
  | "skill.candidate"
  | "skill.promote";

export type TaskQueryStatus = "active" | "not-active";

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  title: string;
  dedupeKey: string | null;
  conversationId: string | null;
  relatedSessionId: string | null;
  runtimeCommandId: string | null;
  queueJobId: string | null;
  memoryRunId: string | null;
  skillCandidateId: string | null;
  permissionRequestId: string | null;
  retryOfTaskId: string | null;
  attempt: number;
  reason: string | null;
  resultSummary: string | null;
  errorSummary: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateTaskInput {
  kind: TaskKind;
  title: string;
  dedupeKey?: string | null;
  conversationId?: string | null;
  relatedSessionId?: string | null;
  retryOfTaskId?: string | null;
  attempt?: number;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateOrReusePlannedTaskInput {
  dedupeKey: string;
  create: CreateTaskInput;
  update?: Omit<TaskPatch, "status">;
}

export interface CreateOrReusePlannedTaskResult {
  task: TaskRecord;
  reused: boolean;
}

export interface TaskPatch {
  status?: TaskStatus;
  title?: string;
  conversationId?: string | null;
  relatedSessionId?: string | null;
  runtimeCommandId?: string | null;
  queueJobId?: string | null;
  memoryRunId?: string | null;
  skillCandidateId?: string | null;
  permissionRequestId?: string | null;
  reason?: string | null;
  resultSummary?: string | null;
  errorSummary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TaskSummary {
  id: string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  reason: string | null;
  resultSummary: string | null;
  errorSummary: string | null;
  canRetry: boolean;
  canCancel: boolean;
  conversationId: string | null;
  relatedSessionId: string | null;
  runtimeCommandId: string | null;
  queueJobId: string | null;
  memoryRunId: string | null;
  skillCandidateId: string | null;
  permissionRequestId: string | null;
  retryOfTaskId: string | null;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TaskEventRecord {
  id: number;
  taskId: string;
  status: TaskStatus;
  reason: string | null;
  createdAt: string;
}

export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  "planned",
  "running",
  "paused_approval",
];

export const NOT_ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  "completed",
  "failed",
  "cancelled",
];
