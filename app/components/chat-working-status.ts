import type { TaskDto } from "@/server/dto";
import type { SerializableBotMessage, SerializableSystemPermissionRequest, WebLiveEvent } from "../../src/web/live-events";
import type { LocalChatTurnPhase } from "./chat-turn-model";
import type { WorkingLabel } from "./chat-timeline-entry";

type ActivityEvent = Extract<WebLiveEvent, { type: "activity" }>;
export interface WorkingStatus {
  label: WorkingLabel;
  detail?: string;
}

interface ChatMessageLike {
  message: SerializableBotMessage;
}

export function deriveWorkingLabel(input: {
  messages: ChatMessageLike[];
  activities: ActivityEvent[];
  permissionRequests: SerializableSystemPermissionRequest[];
  tasks: TaskDto[];
  localTurnPhase?: LocalChatTurnPhase;
}): WorkingStatus {
  if (input.permissionRequests.some((request) => request.status === "pending")) {
    return { label: "Waiting for approval" };
  }
  if (input.tasks.some((task) => task.status === "paused_approval")) {
    return { label: "Waiting for approval" };
  }
  const latestUserAt = latestUserCreatedAt(input.messages);
  const candidates: Array<{ at: string; status: WorkingStatus }> = [];
  for (const { message } of input.messages) {
    if (message.role !== "assistant" || message.kind !== "tool_call") continue;
    if (latestUserAt && message.createdAt < latestUserAt) continue;
    candidates.push({
      at: message.createdAt,
      status: { label: labelForTool(message.toolName) },
    });
  }
  for (const activity of input.activities) {
    if (latestUserAt && activity.createdAt < latestUserAt) continue;
    candidates.push({
      at: activity.createdAt,
      status: {
        label: labelForActivity(activity.label),
        ...(agentStatusDetail(activity) ? { detail: agentStatusDetail(activity) } : {}),
      },
    });
  }
  candidates.sort((a, b) => a.at.localeCompare(b.at));
  const latest = candidates.at(-1)?.status;
  if (latest) return latest;
  if (input.localTurnPhase === "submitting") return { label: "Sending" };
  return { label: "Thinking" };
}

function agentStatusDetail(activity: ActivityEvent): string | undefined {
  if (!activity.detail || typeof activity.detail !== "object") return undefined;
  const detail = activity.detail as { kind?: unknown; message?: unknown };
  return detail.kind === "agent-status" && typeof detail.message === "string"
    ? detail.message
    : undefined;
}

function latestUserCreatedAt(messages: ChatMessageLike[]): string | null {
  let latest: string | null = null;
  for (const { message } of messages) {
    if (message.role !== "user") continue;
    if (!latest || message.createdAt > latest) latest = message.createdAt;
  }
  return latest;
}

function labelForTool(toolName: string | undefined): WorkingLabel {
  if (!toolName) return "Thinking";
  if (toolName === "web.search" || toolName === "skills.search" || toolName === "memory.recall") {
    return "Searching";
  }
  if (toolName === "web.fetch") return "Reading";
  if (toolName === "sandbox.bash" || toolName === "system.bash") return "Running";
  if (toolName === "sandbox.edit" || toolName.startsWith("artifact.")) return "Coding";
  return "Thinking";
}

function labelForActivity(label: string): WorkingLabel {
  const text = label.toLowerCase();
  if (text.includes("approval") || text.includes("permission")) return "Waiting for approval";
  if (text.includes("search")) return "Searching";
  if (text.includes("fetch") || text.includes("read")) return "Reading";
  if (label.startsWith("$") || label.startsWith("host $") || text.includes("command")) return "Running";
  if (text.includes("artifact") || text.includes("edit") || text.includes("cod")) return "Coding";
  return "Thinking";
}
