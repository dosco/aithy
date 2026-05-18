import { ACTIVE_TASK_STATUSES } from "./types";
import type { TaskRecord, TaskSummary } from "./types";

export function taskSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: task.status,
    reason: task.errorSummary ?? task.reason ?? task.resultSummary,
    resultSummary: task.resultSummary,
    errorSummary: task.errorSummary,
    canRetry: task.status === "failed" && task.kind === "chat.turn" && typeof task.metadata.text === "string",
    canCancel: ACTIVE_TASK_STATUSES.includes(task.status),
    conversationId: task.conversationId,
    relatedSessionId: task.relatedSessionId,
    runtimeCommandId: task.runtimeCommandId,
    queueJobId: task.queueJobId,
    memoryRunId: task.memoryRunId,
    skillCandidateId: task.skillCandidateId,
    permissionRequestId: task.permissionRequestId,
    retryOfTaskId: task.retryOfTaskId,
    attempt: task.attempt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  };
}
