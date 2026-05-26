import type { AxChatLogEntry, AxChatLogMessage } from "@ax-llm/ax";
import type { NormalizedTrainingTraceEntry, TrainingTraceMessage, TrainingTraceStage } from "./types";

export function normalizeChatLogEntries(input: {
  sessionId: string;
  runId?: string | null;
  entries: readonly AxChatLogEntry[];
  createdAt?: string;
}): NormalizedTrainingTraceEntry[] {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return input.entries
    .map((entry) => normalizeChatLogEntry(input.sessionId, input.runId ?? null, entry, createdAt))
    .filter((entry) => entry.messages.length > 0);
}

export function normalizeChatLogEntry(
  sessionId: string,
  runId: string | null,
  entry: AxChatLogEntry,
  createdAt: string,
): NormalizedTrainingTraceEntry {
  const name = cleanString(entry.name) ?? null;
  return {
    sessionId,
    runId,
    component: componentForTraceName(name),
    stage: normalizeStage(entry.stage),
    name,
    model: cleanString(entry.model) ?? "unknown",
    axSessionId: cleanString(entry.sessionId) ?? null,
    remoteId: cleanString(entry.remoteId) ?? null,
    remoteRequestId: cleanString(entry.remoteRequestId) ?? null,
    remoteSessionId: cleanString(entry.remoteSessionId) ?? null,
    providerMetadata: entry.providerMetadata ?? null,
    modelUsage: entry.modelUsage ?? null,
    messages: normalizeMessages(entry.messages),
    createdAt,
  };
}

export function normalizeMessages(messages: readonly AxChatLogMessage[]): TrainingTraceMessage[] {
  const out: TrainingTraceMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "system" || message.role === "user" || message.role === "assistant") {
      if (typeof message.content === "string") out.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "tool" && typeof message.content === "string") {
      out.push({ role: "tool", name: cleanString(message.name) ?? "tool", content: message.content });
    }
  }
  return out;
}

export function componentForTraceName(name: string | null): string {
  const normalized = normalizeLabel(name);
  if (!normalized) return "chat.unknown";
  if (/(responder|response|final)/.test(normalized)) return "chat.responder";
  if (/(distill|distiller)/.test(normalized)) return "chat.responder";
  if (/(actor|executor|explorer|task)/.test(normalized)) return "chat.actor";
  return `chat.${normalized}`;
}

export function normalizeStage(stage: unknown): TrainingTraceStage {
  return stage === "ctx" || stage === "task" ? stage : null;
}

function normalizeLabel(value: string | null): string {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") ?? "";
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

