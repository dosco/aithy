import type { TrainingTraceMessage } from "./types";

export function sftJsonl(rows: Array<{ messages: TrainingTraceMessage[] }>): string {
  return jsonl(rows.map((row) => ({ messages: row.messages })));
}

export function dpoJsonl(
  rows: Array<{
    promptMessages: TrainingTraceMessage[];
    chosenMessages: TrainingTraceMessage[];
    rejectedMessages: TrainingTraceMessage[];
  }>,
): string {
  return jsonl(rows.map((row) => ({
    prompt: row.promptMessages,
    chosen: row.chosenMessages,
    rejected: row.rejectedMessages,
  })));
}

function jsonl(rows: unknown[]): string {
  if (rows.length === 0) return "";
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

