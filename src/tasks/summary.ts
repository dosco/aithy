import { ACTIVE_TASK_STATUSES } from "./types";
import type { TaskRecord, TaskSummary } from "./types";

export function taskSummary(task: TaskRecord): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: task.status,
    reason: task.errorSummary ?? task.reason ?? task.resultSummary,
    canRetry: task.status === "failed" && task.kind === "chat.turn" && typeof task.metadata.text === "string",
    canCancel: ACTIVE_TASK_STATUSES.includes(task.status),
    relatedSessionId: task.relatedSessionId,
    updatedAt: task.updatedAt,
  };
}

