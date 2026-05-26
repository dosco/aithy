import type { TaskDto } from "@/server/dto";
import type { SerializableBotMessage, SerializableSystemPermissionRequest, WebLiveEvent } from "../../src/web/live-events";
import type { LocalChatTurnPhase } from "./chat-turn-model";
import type { WorkingLabel } from "./chat-timeline-entry";

type ActivityEvent = Extract<WebLiveEvent, { type: "activity" }>;

interface ChatMessageLike {
  message: SerializableBotMessage;
}

export function deriveWorkingLabel(input: {
  messages: ChatMessageLike[];
  activities: ActivityEvent[];
  permissionRequests: SerializableSystemPermissionRequest[];
  tasks: TaskDto[];
  localTurnPhase?: LocalChatTurnPhase;
}): WorkingLabel {
  if (input.permissionRequests.some((request) => request.status === "pending")) {
    return "Waiting for approval";
  }
  if (input.tasks.some((task) => task.status === "paused_approval")) {
    return "Waiting for approval";
  }
  const latestUserAt = latestUserCreatedAt(input.messages);
  const candidates: Array<{ at: string; label: WorkingLabel }> = [];
  for (const { message } of input.messages) {
    if (message.role !== "assistant" || message.kind !== "tool_call") continue;
    if (latestUserAt && message.createdAt < latestUserAt) continue;
    candidates.push({
      at: message.createdAt,
      label: labelForTool(message.toolName),
    });
  }
  for (const activity of input.activities) {
    if (latestUserAt && activity.createdAt < latestUserAt) continue;
    candidates.push({
      at: activity.createdAt,
      label: labelForActivity(activity.label),
    });
  }
  candidates.sort((a, b) => a.at.localeCompare(b.at));
  const latest = candidates.at(-1)?.label;
  if (latest) return latest;
  if (input.localTurnPhase === "submitting") return "Sending";
  return "Thinking";
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
