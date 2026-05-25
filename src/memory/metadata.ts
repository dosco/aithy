import {
  MEMORY_GUIDANCE_VALUES,
  MEMORY_SCOPE_KINDS,
  MEMORY_SUBJECTS,
  type MemoryGuidance,
  type MemoryKind,
  type MemoryScopeKind,
  type MemorySubject,
  type MemoryUpsert,
} from "./types";

export interface NormalizedMemoryMetadata {
  subject: MemorySubject;
  scopeKind: MemoryScopeKind;
  scopeRef: string | null;
  guidance: MemoryGuidance;
}

export function defaultMemoryGuidance(kind: MemoryKind): MemoryGuidance {
  return kind === "instruction" ? "standing_request" : "context";
}

export function normalizeMemoryMetadata(input: Pick<MemoryUpsert, "kind" | "subject" | "scopeKind" | "scopeRef" | "guidance">): NormalizedMemoryMetadata {
  const subject = input.subject ?? "user";
  const scopeKind = input.scopeKind ?? "global";
  const scopeRef = scopeKind === "global" ? null : cleanScopeRef(input.scopeRef);
  const guidance = input.guidance ?? defaultMemoryGuidance(input.kind);
  return { subject, scopeKind, scopeRef, guidance };
}

export function assertMemorySubject(value: string | undefined): MemorySubject | undefined {
  if (!value) return undefined;
  if ((MEMORY_SUBJECTS as readonly string[]).includes(value)) return value as MemorySubject;
  throw new Error(`Invalid memory subject: ${value}. Expected one of ${MEMORY_SUBJECTS.join(", ")}.`);
}

export function assertMemoryScopeKind(value: string | undefined): MemoryScopeKind | undefined {
  if (!value) return undefined;
  if ((MEMORY_SCOPE_KINDS as readonly string[]).includes(value)) return value as MemoryScopeKind;
  throw new Error(`Invalid memory scope kind: ${value}. Expected one of ${MEMORY_SCOPE_KINDS.join(", ")}.`);
}

export function assertMemoryGuidance(value: string | undefined): MemoryGuidance | undefined {
  if (!value) return undefined;
  if ((MEMORY_GUIDANCE_VALUES as readonly string[]).includes(value)) return value as MemoryGuidance;
  throw new Error(`Invalid memory guidance: ${value}. Expected one of ${MEMORY_GUIDANCE_VALUES.join(", ")}.`);
}

function cleanScopeRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
