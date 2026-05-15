import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { taskStatusEvent } from "../../src/tasks/live";
import { taskSummary } from "../../src/tasks/summary";

const taskIdInput = z.object({ taskId: z.string().min(1) });

export const cancelTask = createServerFn({ method: "POST" })
  .inputValidator(taskIdInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const task = runtime.tasks.get(data.taskId);
    if (!task) throw new Error(`Task not found: ${data.taskId}`);
    if (task.kind === "chat.turn" && task.conversationId) {
      await runtime.dispatcher.cancelByConversation(task.conversationId, "Stopped by user");
    }
    const cancelled = runtime.tasks.update(task.id, {
      status: "cancelled",
      reason: "Stopped by user",
      metadata: { cancellationRequested: true },
    });
    if (cancelled) runtime.live.publish(taskStatusEvent(cancelled));
    return { task: cancelled ? taskSummary(cancelled) : null };
  });

export const retryTask = createServerFn({ method: "POST" })
  .inputValidator(taskIdInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.assertReady();
    const original = runtime.tasks.get(data.taskId);
    if (!original) throw new Error(`Task not found: ${data.taskId}`);
    if (original.kind !== "chat.turn" || original.status !== "failed") {
      throw new Error("Only failed chat tasks can be retried");
    }
    const text = original.metadata.text;
    const skillIds = original.metadata.skillIds;
    if (typeof text !== "string") throw new Error("Task is missing retry text");
    const conversationId = original.conversationId ?? original.relatedSessionId;
    if (!conversationId) throw new Error("Task is missing a related session");
    const next = runtime.tasks.create({
      kind: "chat.turn",
      title: original.title,
      conversationId,
      relatedSessionId: original.relatedSessionId ?? conversationId,
      retryOfTaskId: original.id,
      attempt: original.attempt + 1,
      reason: "Retry queued",
      metadata: {
        text,
        skillIds: Array.isArray(skillIds) ? skillIds.filter((id): id is string => typeof id === "string") : [],
      },
    });
    runtime.live.publish(taskStatusEvent(next));
    const queued = await runtime.dispatcher.enqueueUserChat({
      conversationId,
      text,
      createdAt: new Date().toISOString(),
      skillIds: Array.isArray(skillIds) ? skillIds.filter((id): id is string => typeof id === "string") : [],
      taskId: next.id,
    });
    const linked = runtime.tasks.update(next.id, {
      queueJobId: queued.jobId,
      reason: "Retry queued",
    });
    if (linked) runtime.live.publish(taskStatusEvent(linked));
    return { task: taskSummary(linked ?? next) };
  });
