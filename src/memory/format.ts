import type { MemoryEntry } from "./types";

/** Markdown chunk written into the agent's `inputs.memories[].content`. */
export function formatMemoryForRecall(m: MemoryEntry): string {
  const labels = m.labels.length > 0 ? ` · labels: ${m.labels.join(", ")}` : "";
  const meta = memoryMetadata(m);
  const head = `**${m.kind}** · importance ${m.importance.toFixed(2)}${labels}`;
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
