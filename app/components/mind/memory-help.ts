import type { MemoryGuidance, MemoryKind, MemoryScopeKind, MemorySubject } from "../../../src/memory/types";

export interface MemoryHelpInput {
  kind: MemoryKind;
  subject: MemorySubject;
  scopeKind: MemoryScopeKind;
  scopeRef: string | null;
  guidance: MemoryGuidance;
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
  relationship: "relationship context",
  project_context: "project context",
  decision: "decision context",
  task: "task context",
  goal: "goal context",
  event: "event context",
  resource: "resource context",
  constraint: "constraint context",
  vocabulary: "vocabulary context",
  note: "general context",
  lesson: "operational lesson",
  failure_mode: "failure mode",
};

export function buildMemoryHelp(input: MemoryHelpInput): MemoryHelp {
  const summary = `Can be recalled as ${input.subject} ${KIND_CONTEXT[input.kind]} when a related request and scope match it.`;
  const details = [recallDetail(input), scopeDetail(input), guidanceDetail(input), ...timingDetails(input)];
  if (input.frequency?.trim()) details.push(`Frequency: ${input.frequency.trim()}`);
  if (input.evidence?.trim()) details.push("Supported by saved evidence");
  return { summary, details };
}

function scopeDetail(input: MemoryHelpInput): string {
  if (input.scopeKind === "global") return "Global scope";
  return `${input.scopeKind === "workspace" ? "Workspace" : "Session"} scope${input.scopeRef ? `: ${input.scopeRef}` : ""}`;
}

function guidanceDetail(input: MemoryHelpInput): string {
  return input.guidance === "standing_request"
    ? "Standing user request; still below tool and safety policy"
    : "Advisory context";
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

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}
