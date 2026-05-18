import type { NotificationCreate, NotificationEntry } from "../notifications/types";
import { stripAttentionPrefix } from "./prompt";
import type { SqliteAutomationStore } from "./store";

export function completeAutomationRun(input: {
  automations: SqliteAutomationStore;
  automationId: string;
  automationRunId: string;
  text: string;
  conversationId: string;
  notify?: (input: NotificationCreate) => NotificationEntry | void;
}): void {
  const automation = input.automations.get(input.automationId);
  if (!automation) return;
  const parsed = stripAttentionPrefix(input.text);
  const status = input.text === "[stopped]" ? "cancelled" : input.text.startsWith("Error:") ? "failed" : "completed";
  input.automations.updateRun(input.automationRunId, {
    status,
    resultSummary: status === "completed" ? compact(parsed.text) : null,
    errorSummary: status === "failed" ? compact(input.text) : null,
  });
  input.automations.update(automation.id, {
    status: automationStatusAfterRun(automation.status, status, automation.attentionType, automation.schedule.kind),
    lastRunAt: new Date().toISOString(),
  });
  if (status === "failed") {
    input.notify?.({
      kind: "automation.failed",
      title: `Attention needs you: ${automation.title}`,
      body: compact(input.text),
      link: `/chat/${input.conversationId}`,
    });
    return;
  }
  if (status !== "completed") return;
  if (automation.notificationPolicy === "silent" || automation.notificationPolicy === "failures_only") return;
  if (automation.notificationPolicy === "attention_only" && !parsed.needsAttention) return;
  input.notify?.({
    kind: parsed.needsAttention ? "automation.needs_attention" : "automation.completed",
    title: parsed.needsAttention ? `Attention found something: ${automation.title}` : `Attention looked: ${automation.title}`,
    body: compact(parsed.text),
    link: `/chat/${input.conversationId}`,
  });
}

export function failAutomationRun(input: {
  automations: SqliteAutomationStore;
  automationId?: string;
  automationRunId?: string;
  error: Error;
  conversationId?: string | null;
  notify?: (input: NotificationCreate) => NotificationEntry | void;
}): void {
  if (!input.automationId || !input.automationRunId) return;
  const automation = input.automations.get(input.automationId);
  if (!automation) return;
  input.automations.updateRun(input.automationRunId, {
    status: "failed",
    errorSummary: input.error.message,
  });
  input.automations.update(automation.id, {
    status: "needs_input",
    lastRunAt: new Date().toISOString(),
  });
  input.notify?.({
    kind: "automation.failed",
    title: `Attention failed: ${automation.title}`,
    body: compact(input.error.message),
    link: input.conversationId ? `/chat/${input.conversationId}` : `/chat/${automation.originSessionId}`,
  });
}

function compact(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > 500 ? `${cleaned.slice(0, 497)}...` : cleaned;
}

function automationStatusAfterRun(
  current: "active" | "paused" | "needs_input" | "archived",
  runStatus: "completed" | "failed" | "cancelled",
  attentionType?: "vigil" | "reminder" | "ritual" | "briefing",
  scheduleKind?: "cron" | "interval" | "once",
): "active" | "paused" | "needs_input" | "archived" {
  if (runStatus === "failed") return "needs_input";
  if (runStatus === "cancelled") return current;
  if (attentionType === "reminder" && scheduleKind === "once") return "archived";
  if (current === "paused" || current === "archived") return current;
  return "active";
}
