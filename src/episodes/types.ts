export type EpisodeOutcome = "success" | "partial" | "failure";

export const EPISODE_OUTCOMES: readonly EpisodeOutcome[] = [
  "success",
  "partial",
  "failure",
];

export interface AgentEpisodeEntry {
  id: string;
  dedupeKey: string;
  task: string;
  approach: string;
  outcome: EpisodeOutcome;
  notes: string;
  toolNames: string[];
  sourceSessionId: string;
  evidenceStartMessageId: number;
  evidenceEndMessageId: number;
  error: string | null;
  artifactIds: string[];
  importance: number;
  seenCount: number;
  createdAt: string;
  updatedAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
  retrievedCount: number;
}

export interface AgentEpisodeUpsert {
  task: string;
  approach: string;
  outcome: EpisodeOutcome;
  notes?: string;
  toolNames?: readonly string[];
  sourceSessionId: string;
  evidenceStartMessageId: number;
  evidenceEndMessageId: number;
  error?: string | null;
  artifactIds?: readonly string[];
  importance?: number;
  canonicalText?: string;
}

export interface EpisodeSearchOptions {
  limit?: number;
  excludeIds?: readonly string[];
  markRecalled?: boolean;
}
