export type MemoryKind =
  | "fact"
  | "preference"
  | "instruction"
  | "relationship"
  | "project_context"
  | "decision"
  | "task"
  | "goal"
  | "event"
  | "resource"
  | "constraint"
  | "vocabulary"
  | "lesson"
  | "failure_mode"
  | "note";

export const MEMORY_KINDS: readonly MemoryKind[] = [
  "fact",
  "preference",
  "instruction",
  "relationship",
  "project_context",
  "decision",
  "task",
  "goal",
  "event",
  "resource",
  "constraint",
  "vocabulary",
  "lesson",
  "failure_mode",
  "note",
];

export type MemorySubject = "user" | "agent" | "project";

export const MEMORY_SUBJECTS: readonly MemorySubject[] = [
  "user",
  "agent",
  "project",
];

export type MemoryScopeKind = "global" | "workspace" | "session";

export const MEMORY_SCOPE_KINDS: readonly MemoryScopeKind[] = [
  "global",
  "workspace",
  "session",
];

export type MemoryGuidance = "context" | "standing_request";

export const MEMORY_GUIDANCE_VALUES: readonly MemoryGuidance[] = [
  "context",
  "standing_request",
];

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  subject: MemorySubject;
  scopeKind: MemoryScopeKind;
  scopeRef: string | null;
  guidance: MemoryGuidance;
  title: string;
  body: string;
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
  subject?: MemorySubject;
  scopeKind?: MemoryScopeKind;
  scopeRef?: string | null;
  guidance?: MemoryGuidance;
  title: string;
  body: string;
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
  subjects?: readonly MemorySubject[];
  guidance?: readonly MemoryGuidance[];
  scope?: MemoryScopeSearch;
  limit?: number;
  /**
   * Memory IDs to exclude from results. Use this when the agent has already
   * been fed certain memories earlier in the same run — passing them here
   * drops them at the SQL/vec layer (not post-slice) so the returned set
   * always honors the requested limit.
  */
  excludeIds?: readonly string[];
  /** Skip recall/retrieval counter updates for internal lookups such as dedupe. */
  markRecalled?: boolean;
}

export interface MemoryScopeSearch {
  includeGlobal?: boolean;
  workspaceRef?: string | null;
  sessionRef?: string | null;
}
