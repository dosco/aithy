import type { AgentEpisodeEntry } from "./types";

export function formatEpisodeForRecall(episode: AgentEpisodeEntry, rawTranscriptExcerpt?: string): string {
  return [
    `# Past similar task: ${episode.task}`,
    "Type: strategy hint, not a user fact",
    `Outcome: ${episode.outcome}`,
    "",
    `Lesson: ${episode.approach}`,
    episode.notes ? `Notes: ${episode.notes}` : null,
    episode.toolNames.length > 0 ? `Tools used: ${episode.toolNames.join(", ")}` : null,
    episode.error ? `Error to avoid: ${episode.error}` : null,
    rawTranscriptExcerpt ? `\nEvidence excerpt:\n${rawTranscriptExcerpt}` : null,
  ].filter((part) => part !== null).join("\n");
}
