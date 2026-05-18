import type { MemoryKind, MemoryLabel } from "../../../src/memory/types";

export interface MemoryHelpInput {
  kind: MemoryKind;
  labels: readonly MemoryLabel[];
  validFrom: string | null;
  validUntil: string | null;
  evidence: string | null;
  frequency: string | null;
  retrievedCount: number;
  lastRecalledAt: string | null;
}

export interface MemoryHelp {
  summary: string;
  details: string[];
}

const KIND_CONTEXT: Record<MemoryKind, string> = {
  fact: "factual context",
  preference: "preference context",
  instruction: "standing guidance",
  event: "event context",
};

const LABEL_CONTEXT: Record<MemoryLabel, string> = {
  personal: "personal context",
  project: "project work",
  tooling: "tool choices",
  workflow: "work habits",
  health: "health context",
  travel: "travel plans",
  household: "household context",
  media: "media tastes",
  art: "art context",
  deadline: "deadlines",
  recurring: "recurring routines",
  time_bound: "time-limited situations",
  verbatim_detail: "exact wording",
};

export function buildMemoryHelp(input: MemoryHelpInput): MemoryHelp {
  const contexts = input.labels.map((label) => LABEL_CONTEXT[label]);
  const summary = contexts.length > 0
    ? `Can be recalled as ${KIND_CONTEXT[input.kind]} for ${humanList(contexts)}.`
    : `Can be recalled as ${KIND_CONTEXT[input.kind]} when a related request matches it.`;
  const details = [recallDetail(input), ...timingDetails(input)];
  if (input.frequency?.trim()) details.push(`Frequency: ${input.frequency.trim()}`);
  if (input.evidence?.trim()) details.push("Supported by saved evidence");
  if (input.labels.includes("time_bound") && !input.validUntil) {
    details.push("Marked time-bound; check current dates before relying on it");
  }
  return { summary, details };
}

function recallDetail(input: MemoryHelpInput): string {
  if (input.retrievedCount <= 0) return "Not recalled yet";
  const count = `Recalled ${input.retrievedCount} ${input.retrievedCount === 1 ? "time" : "times"}`;
  return input.lastRecalledAt
    ? `${count}; last recalled ${dateOnly(input.lastRecalledAt)}`
    : count;
}

function timingDetails(input: MemoryHelpInput): string[] {
  if (input.validFrom && input.validUntil) {
    return [`Applies ${input.validFrom} through ${input.validUntil}`];
  }
  if (input.validFrom) return [`Applies from ${input.validFrom}`];
  if (input.validUntil) return [`Applies until ${input.validUntil}`];
  return [];
}

function humanList(items: readonly string[]): string {
  const unique = [...new Set(items)];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}
