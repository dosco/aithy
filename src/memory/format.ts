import type { MemoryEntry } from "./types";

/** Markdown chunk written into the agent's `inputs.memories[].content`. */
export function formatMemoryForRecall(m: MemoryEntry): string {
  const meta = memoryMetadata(m);
  const subject = m.subject ?? "user";
  const scopeKind = m.scopeKind ?? "global";
  const guidance = m.guidance ?? "context";
  const scope = scopeKind === "global" ? "global" : `${scopeKind}:${m.scopeRef ?? "unspecified"}`;
  const head = `**${m.kind}** · subject ${subject} · scope ${scope} · guidance ${guidance} · importance ${m.importance.toFixed(2)}`;
  return `# ${m.title}\n${head}${meta ? `\n${meta}` : ""}\n\n${m.body}`;
}

export function formatMemoryPreview(m: Pick<MemoryEntry, "title" | "body">): string {
  const body = compactText(m.body);
  return body ? `${m.title} - ${body}` : m.title;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function memoryMetadata(m: MemoryEntry): string {
  return [
    m.frequency ? `frequency: ${m.frequency}` : null,
    m.validFrom || m.validUntil ? `valid: ${m.validFrom ?? "unknown"} to ${m.validUntil ?? "unknown"}` : null,
    m.durationDays !== null ? `duration_days: ${m.durationDays}` : null,
    m.evidence ? `evidence: ${m.evidence}` : null,
  ].filter(Boolean).join("\n");
}
