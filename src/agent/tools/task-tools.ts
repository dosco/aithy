import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import type { TaskQueryStatus } from "../../tasks/types";
import type { ToolContext } from "../tool-context";

export function createTaskTools(ctx: ToolContext): AxAgentFunction[] {
  if (!ctx.tasks) return [];
  return [
    fn("getTasks")
      .namespace("tasks")
      .description(
        "List the user's visible tasks when you need to check what is planned, running, paused, failed, completed, or cancelled. This is read-only and returns compact summaries.",
      )
      .arg("status", f.string("Use 'active' for planned/running/paused tasks, or 'not-active' for recent completed/failed/cancelled tasks."))
      .returnsField("tasks", f.object({
        id: f.string("Task id"),
        title: f.string("Short task title"),
        kind: f.string("Task kind"),
        status: f.string("Current task status"),
        reason: f.string("Short status reason").optional(),
        canRetry: f.boolean("Whether the user can retry the task"),
        canCancel: f.boolean("Whether the user can cancel the task"),
        relatedSessionId: f.string("Related chat session id").optional(),
        updatedAt: f.string("ISO timestamp when the task last changed"),
      }, "Compact task summary").array("Visible tasks"))
      .handler(async ({ status }) => {
        const normalized = normalizeStatus(status);
        const tasks = ctx.tasks!.summariesForAgent({
          status: normalized,
          conversationId: ctx.session.conversationId,
          limit: 10,
        });
        return { tasks: tasks.map((task) => ({
          ...task,
          reason: task.reason ?? undefined,
          relatedSessionId: task.relatedSessionId ?? undefined,
        })) };
      })
      .build(),
  ];
}

function normalizeStatus(value: string): TaskQueryStatus {
  if (value === "active" || value === "not-active") return value;
  throw new Error("tasks.getTasks status must be 'active' or 'not-active'");
}
