import type { WebLiveEvent } from "../web/live-events";
import { taskSummary } from "./summary";
import type { TaskRecord } from "./types";

export function taskStatusEvent(task: TaskRecord): WebLiveEvent {
  return {
    type: "task-status",
    id: crypto.randomUUID(),
    conversationId: task.conversationId,
    createdAt: new Date().toISOString(),
    task: taskSummary(task),
  };
}
