import type { ChatMessageItem } from "@/components/chat-timeline";
import type { WebStateDto } from "@/server/dto";

export type LocalChatTurnPhase = "submitting" | "awaiting_reply" | "idle";
export type ChatTurnStatus = "idle" | "busy" | "success" | "failed" | "cancelled";

export interface LocalChatTurn {
  conversationId: string | null;
  userCreatedAt: string | null;
  taskId: string | null;
  phase: LocalChatTurnPhase;
}

export interface ChatTurnMessage {
  conversationId: string | null;
  createdAt: string;
  content: string;
}

export type ChatTask = WebStateDto["tasks"][number];

export interface ChatTurn {
  sessionId: string | null;
  latestUser: ChatTurnMessage | null;
  terminalAssistant: ChatTurnMessage | null;
  latestTask: ChatTask | null;
  activeTask: ChatTask | null;
  localTurn: LocalChatTurn;
  status: ChatTurnStatus;
  busy: boolean;
  deniedPermissionAfterLatestUser: boolean;
}

export const IDLE_LOCAL_CHAT_TURN: LocalChatTurn = {
  conversationId: null,
  userCreatedAt: null,
  taskId: null,
  phase: "idle",
};

export function latestUserTurn(
  messages: ChatMessageItem[],
  sessionId: string | null,
): ChatTurnMessage | null {
  let latest: ChatTurnMessage | null = null;
  for (const { message } of messages) {
    if (message.role !== "user") continue;
    if (latest && latest.createdAt >= message.createdAt) continue;
    latest = {
      conversationId: sessionId,
      createdAt: message.createdAt,
      content: message.content,
    };
  }
  return latest;
}

export function latestTerminalAssistant(
  messages: ChatMessageItem[],
): ChatTurnMessage | null {
  let latest: ChatTurnMessage | null = null;
  for (const { message } of messages) {
    if (message.role !== "assistant" || message.kind !== "text") continue;
    if (message.content.trim().length === 0) continue;
    if (latest && latest.createdAt >= message.createdAt) continue;
    latest = {
      conversationId: null,
      createdAt: message.createdAt,
      content: message.content,
    };
  }
  return latest;
}

export function deriveChatTurn({
  sessionId,
  messages,
  tasks,
  localTurn,
}: {
  sessionId: string | null;
  messages: ChatMessageItem[];
  tasks: ChatTask[];
  localTurn: LocalChatTurn;
}): ChatTurn {
  const latestUser = latestUserTurn(messages, sessionId);
  const terminalAssistant = latestTerminalAssistant(messages);
  const assistantCompletesLatestUser =
    Boolean(terminalAssistant)
    && (!latestUser || terminalAssistant!.createdAt >= latestUser.createdAt);
  const latestTask = latestChatTask(tasks, sessionId);
  const activeBusyTask = latestTaskMatching(tasks, sessionId, (task) => isBusyTaskStatus(task.status));
  const visibleTask = latestTaskMatching(tasks, sessionId, (task) => isBannerTaskStatus(task.status));
  const deniedPermissionAfterLatestUser = hasDeniedPermissionAfter(messages, latestUser);
  const activeTask =
    assistantCompletesLatestUser && visibleTask && isBusyTaskStatus(visibleTask.status)
      ? null
      : visibleTask;
  const localSubmitWithoutUser =
    localTurn.phase === "submitting" && localTurn.userCreatedAt === null;
  const base = {
    sessionId,
    latestUser,
    terminalAssistant: assistantCompletesLatestUser ? terminalAssistant : null,
    latestTask,
    activeTask,
    localTurn,
    deniedPermissionAfterLatestUser,
  };

  if (assistantCompletesLatestUser && terminalAssistant && !localSubmitWithoutUser) {
    return {
      ...base,
      status: terminalStatusForAssistantText(terminalAssistant.content),
      busy: false,
    };
  }
  if (localTurn.phase === "submitting") {
    return { ...base, status: "busy", busy: true };
  }
  if (deniedPermissionAfterLatestUser) {
    return { ...base, status: "failed", busy: false };
  }
  if (latestUser && (activeBusyTask || localTurn.phase === "awaiting_reply")) {
    return { ...base, status: "busy", busy: true };
  }
  if (latestTask?.status === "failed") {
    return { ...base, status: "failed", busy: false };
  }
  if (latestTask?.status === "cancelled") {
    return { ...base, status: "cancelled", busy: false };
  }
  return { ...base, status: "idle", busy: false };
}

export function shouldDrainPending({
  previous,
  current,
}: {
  previous: ChatTurn | null;
  current: ChatTurn;
}): boolean {
  if (!previous) return false;
  if (current.busy || current.status !== "success") return false;
  if (!current.latestUser || !current.terminalAssistant) return false;
  if (previous.sessionId !== current.sessionId) return false;
  if (previous.latestUser?.createdAt !== current.latestUser.createdAt) return false;
  if (!previous.busy) return false;
  if (
    previous.localTurn.phase !== "idle"
    && previous.localTurn.userCreatedAt !== current.latestUser.createdAt
  ) {
    return false;
  }
  if (current.deniedPermissionAfterLatestUser) return false;
  const assistantBecameVisible =
    !previous.terminalAssistant
    || previous.terminalAssistant.createdAt !== current.terminalAssistant.createdAt;
  return assistantBecameVisible
    && current.terminalAssistant.createdAt >= current.latestUser.createdAt;
}

function latestChatTask(tasks: ChatTask[], sessionId: string | null): ChatTask | null {
  return latestTaskMatching(tasks, sessionId, () => true);
}

function latestTaskMatching(
  tasks: ChatTask[],
  sessionId: string | null,
  predicate: (task: ChatTask) => boolean,
): ChatTask | null {
  let latest: ChatTask | null = null;
  for (const task of tasks) {
    if (task.kind !== "chat.turn" || task.relatedSessionId !== sessionId) continue;
    if (!predicate(task)) continue;
    if (!latest || compareTasks(task, latest) > 0) latest = task;
  }
  return latest;
}

function compareTasks(left: ChatTask, right: ChatTask): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? 1 : -1;
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? 1 : -1;
  return left.id > right.id ? 1 : left.id < right.id ? -1 : 0;
}

function hasDeniedPermissionAfter(
  messages: ChatMessageItem[],
  latestUser: ChatTurnMessage | null,
): boolean {
  if (!latestUser) return false;
  for (const { message } of messages) {
    if (message.role !== "assistant" || message.kind !== "permission") continue;
    if (message.createdAt < latestUser.createdAt) continue;
    if (message.status === "denied" || message.status === "timed_out") return true;
  }
  return false;
}

function isBusyTaskStatus(status: ChatTask["status"]): boolean {
  return status === "planned" || status === "running" || status === "paused_approval";
}

function isBannerTaskStatus(status: ChatTask["status"]): boolean {
  return isBusyTaskStatus(status) || status === "failed";
}

function terminalStatusForAssistantText(text: string): ChatTurnStatus {
  if (text === "[stopped]") return "cancelled";
  if (text.startsWith("Error:")) return "failed";
  return "success";
}
