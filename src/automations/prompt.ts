import type { AutomationRecord, AutomationRunRecord } from "./types";

export function automationRunPrompt(input: {
  automation: AutomationRecord;
  run: AutomationRunRecord;
  recentRuns: AutomationRunRecord[];
  now: Date;
}): string {
  const { automation, run, recentRuns, now } = input;
  return [
    `Scheduled attention look: ${automation.title}`,
    "",
    `Attention type: ${automation.attentionType}`,
    `Local time: ${now.toLocaleString(undefined, { timeZone: automation.timezone })} (${automation.timezone})`,
    `Rhythm: ${automation.schedule.human}`,
    `Notification policy: ${automation.notificationPolicy}`,
    `Automation id: ${automation.id}`,
    `Run id: ${run.id}`,
    "",
    "Focus:",
    automation.prompt,
    "",
    attentionInstruction(automation.notificationPolicy),
    "",
    "Recent run summaries:",
    recentRunSummary(recentRuns),
  ].filter(Boolean).join("\n");
}

function attentionInstruction(policy: AutomationRecord["notificationPolicy"]): string {
  if (policy !== "attention_only") return "";
  return [
    "For notification routing, start your final answer with exactly one of:",
    "ATTENTION: when the user should be notified.",
    "NO ATTENTION: when this is only a quiet log.",
    "Then continue with the useful result.",
  ].join("\n");
}

function recentRunSummary(runs: AutomationRunRecord[]): string {
  const completed = runs.filter((run) => run.status === "completed" || run.status === "failed").slice(0, 5);
  if (completed.length === 0) return "No prior runs.";
  return completed.map((run) => {
    const summary = run.resultSummary ?? run.errorSummary ?? run.status;
    return `- ${run.scheduledFor}: ${summary}`;
  }).join("\n");
}

export function stripAttentionPrefix(text: string): {
  text: string;
  needsAttention: boolean;
  explicit: boolean;
} {
  const trimmed = text.trimStart();
  if (trimmed.toUpperCase().startsWith("ATTENTION:")) {
    return { text: trimmed.slice("ATTENTION:".length).trimStart(), needsAttention: true, explicit: true };
  }
  if (trimmed.toUpperCase().startsWith("NO ATTENTION:")) {
    return { text: trimmed.slice("NO ATTENTION:".length).trimStart(), needsAttention: false, explicit: true };
  }
  return { text, needsAttention: false, explicit: false };
}
