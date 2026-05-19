import type { AgentEpisodeEntry } from "./types";

export function formatEpisodeForRecall(episode: AgentEpisodeEntry, rawTranscriptExcerpt?: string): string {
  const tools = episode.toolNames.length > 0 ? `tools: ${episode.toolNames.join(", ")}` : null;
  const error = episode.error ? `error: ${episode.error}` : null;
  const evidence = `evidence: session ${episode.sourceSessionId}, messages #${episode.evidenceStartMessageId}-#${episode.evidenceEndMessageId}`;
  const metadata = [
    `outcome: ${episode.outcome}`,
    `importance ${episode.importance.toFixed(2)}`,
    tools,
    error,
    evidence,
  ].filter(Boolean).join("\n");
  return [
    `# Past similar task: ${episode.task}`,
    "**episode** · strategy hint, not a user fact",
    metadata,
    "",
    `Approach: ${episode.approach}`,
    episode.notes ? `Notes: ${episode.notes}` : null,
    rawTranscriptExcerpt ? `\nRaw transcript excerpt:\n${rawTranscriptExcerpt}` : null,
  ].filter((part) => part !== null).join("\n");
}
