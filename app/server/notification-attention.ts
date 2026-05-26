import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import type { TaskRecord } from "../../src/tasks/types";
import type { NotificationAttentionDto } from "./notification.dto-types";

const FAILED_TASK_ATTENTION_MS = 72 * 60 * 60 * 1000;

export function notificationAttentionDto(runtime: AithyRuntime): NotificationAttentionDto {
  const now = Date.now();
  const permissionRequests = runtime.runtimeStore.pendingPermissionRequestsAll();
  const seenPermissionIds = new Set(permissionRequests.map((request) => request.id));
  const items: NotificationAttentionDto["items"] = [];

  for (const request of permissionRequests) {
    items.push({
      id: `permission-${request.id}`,
      kind: "permission",
      title: permissionAttentionTitle(request.toolName, request.capability),
      body: request.reason || request.command,
      link: `/chat/${request.conversationId}`,
      createdAt: request.createdAt,
    });
  }

  for (const task of runtime.tasks.recent({ status: "active", limit: 100 })) {
    if (task.status !== "paused_approval") continue;
    if (task.permissionRequestId && seenPermissionIds.has(task.permissionRequestId)) continue;
    items.push({
      id: `task-paused-${task.id}`,
      kind: "permission",
      title: "Approval needed",
      body: task.reason,
      link: task.relatedSessionId ? `/chat/${task.relatedSessionId}` : null,
      createdAt: task.updatedAt,
    });
  }

  for (const task of runtime.tasks.recent({ limit: 100 })) {
    if (!isRetryableChatFailure(task)) continue;
    if (!withinWindow(task.updatedAt, now, FAILED_TASK_ATTENTION_MS)) continue;
    items.push({
      id: `task-failed-${task.id}`,
      kind: "task_failed",
      title: "Chat task failed",
      body: task.errorSummary ?? task.reason,
      link: task.relatedSessionId ? `/chat/${task.relatedSessionId}` : null,
      createdAt: task.updatedAt,
    });
  }

  for (const automation of runtime.automations.list()) {
    if (automation.status !== "needs_input") continue;
    items.push({
      id: `automation-${automation.id}`,
      kind: "automation",
      title: `Attention needs help: ${automation.title}`,
      body: null,
      link: "/attentions",
      createdAt: automation.updatedAt,
    });
  }

  for (const notification of runtime.notifications.activeActions(50)) {
    if (notification.kind !== "session.clarification") continue;
    items.push({
      id: `clarification-${notification.id}`,
      kind: "clarification",
      title: notification.title,
      body: notification.body,
      link: notification.link,
      createdAt: notification.createdAt,
    });
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    active: items.length > 0,
    count: items.length,
    label: attentionLabel(items.length),
    items: items.slice(0, 5),
  };
}

function permissionAttentionTitle(toolName: string, capability: string): string {
  if (toolName === "system.bash") return "Command approval needed";
  if (capability.startsWith("web.")) return "Web access approval needed";
  if (capability.startsWith("memory.")) return "Memory approval needed";
  return "Approval needed";
}

function attentionLabel(count: number): string {
  if (count === 0) return "All caught up";
  if (count === 1) return "Aithy needs help";
  return `${count} things need help`;
}

function isRetryableChatFailure(task: TaskRecord): boolean {
  return task.status === "failed" && task.kind === "chat.turn" && typeof task.metadata.text === "string";
}

function withinWindow(iso: string, now: number, windowMs: number): boolean {
  const value = Date.parse(iso);
  return Number.isFinite(value) && now - value <= windowMs;
}
