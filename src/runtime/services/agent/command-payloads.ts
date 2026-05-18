import type { UserChatJobData } from "../../../agent/dispatcher";

export function userChatPayload(payload: unknown): UserChatJobData {
  if (!payload || typeof payload !== "object") throw new Error("Invalid user chat command payload");
  const value = payload as Record<string, unknown>;
  const { conversationId, text, createdAt, skillIds } = value;
  if (
    typeof conversationId !== "string"
    || typeof text !== "string"
    || typeof createdAt !== "string"
    || !Array.isArray(skillIds)
    || !skillIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Invalid user chat command payload");
  }
  const taskId = typeof value.taskId === "string" ? value.taskId : undefined;
  const automationId = typeof value.automationId === "string" ? value.automationId : undefined;
  const automationRunId = typeof value.automationRunId === "string" ? value.automationRunId : undefined;
  return {
    conversationId,
    text,
    createdAt,
    skillIds,
    ...(taskId ? { taskId } : {}),
    ...(automationId ? { automationId } : {}),
    ...(automationRunId ? { automationRunId } : {}),
  };
}

export function payloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
