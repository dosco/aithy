import type { MemoryEntry } from "./types";

/** Markdown chunk written into the agent's `inputs.memories[].content`. */
export function formatMemoryForRecall(m: MemoryEntry): string {
  const head = `**${m.kind}** · importance ${m.importance.toFixed(2)}${m.tags ? ` · tags: ${m.tags}` : ""}`;
  return `# ${m.title}\n${head}\n\n${m.body}`;
}
