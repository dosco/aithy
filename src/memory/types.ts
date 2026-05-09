export type MemoryKind = "fact" | "preference" | "episode" | "instruction";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "fact",
  "preference",
  "episode",
  "instruction",
];

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags: string | null;
  source: string | null;
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
  supersededBy: string | null;
}

export interface MemoryUpsert {
  id?: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tags?: string | null;
  source?: string | null;
  importance?: number;
}

export interface MemorySearchOptions {
  kinds?: readonly MemoryKind[];
  limit?: number;
  /**
   * Memory IDs to exclude from results. Use this when the agent has already
   * been fed certain memories earlier in the same run — passing them here
   * drops them at the SQL/vec layer (not post-slice) so the returned set
   * always honors the requested limit.
   */
  excludeIds?: readonly string[];
}
