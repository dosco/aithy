export type MemoryKind = "fact" | "preference" | "instruction" | "event";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "fact",
  "preference",
  "instruction",
  "event",
];

export type MemoryLabel =
  | "personal"
  | "project"
  | "tooling"
  | "workflow"
  | "health"
  | "travel"
  | "household"
  | "media"
  | "art"
  | "deadline"
  | "recurring"
  | "time_bound"
  | "verbatim_detail";

export const MEMORY_LABELS: readonly MemoryLabel[] = [
  "personal",
  "project",
  "tooling",
  "workflow",
  "health",
  "travel",
  "household",
  "media",
  "art",
  "deadline",
  "recurring",
  "time_bound",
  "verbatim_detail",
];

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  labels: MemoryLabel[];
  validFrom: string | null;
  validUntil: string | null;
  durationDays: number | null;
  evidence: string | null;
  frequency: string | null;
  source: string | null;
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
  retrievedCount: number;
  supersededBy: string | null;
}

export interface MemoryUpsert {
  id?: string;
  kind: MemoryKind;
  title: string;
  body: string;
  labels?: readonly MemoryLabel[];
  validFrom?: string | null;
  validUntil?: string | null;
  durationDays?: number | null;
  evidence?: string | null;
  frequency?: string | null;
  source?: string | null;
  importance?: number;
}

export type MemoryTimingInput = Pick<
  MemoryUpsert,
  "validFrom" | "validUntil" | "durationDays" | "evidence" | "frequency"
>;

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
  labels?: readonly MemoryLabel[];
  /** Skip recall/retrieval counter updates for internal lookups such as dedupe. */
  markRecalled?: boolean;
}
