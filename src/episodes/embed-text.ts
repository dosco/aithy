import { createHash } from "node:crypto";

export interface EpisodeEmbedTextInput {
  task: string;
  approach: string;
  outcome: string;
  notes: string;
  toolNames: readonly string[];
  error?: string | null;
}

export function episodeEmbedText(episode: EpisodeEmbedTextInput): string {
  return [
    episode.task.trim(),
    `approach: ${episode.approach.trim()}`,
    `outcome: ${episode.outcome}`,
    episode.notes.trim() ? `notes: ${episode.notes.trim()}` : null,
    episode.toolNames.length > 0 ? `tools: ${episode.toolNames.join(", ")}` : null,
    episode.error ? `error: ${episode.error}` : null,
  ].filter(Boolean).join("\n");
}

export function episodeHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
