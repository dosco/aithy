import type { SQLQueryBindings } from "bun:sqlite";
import type {
  MemoryEntry,
  MemoryGuidance,
  MemoryKind,
  MemoryScopeKind,
  MemoryScopeSearch,
  MemorySubject,
} from "./types";

export interface MemoryRow {
  id: string;
  kind: MemoryKind;
  subject: MemorySubject;
  scope_kind: MemoryScopeKind;
  scope_ref: string | null;
  guidance: MemoryGuidance;
  title: string;
  body: string;
  valid_from: string | null;
  valid_until: string | null;
  duration_days: number | null;
  evidence: string | null;
  frequency: string | null;
  source: string | null;
  importance: number;
  created_at: string;
  updated_at: string;
  last_recalled_at: string | null;
  recall_count: number;
  retrieved_count: number;
  superseded_by: string | null;
}

export function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    scopeKind: row.scope_kind,
    scopeRef: row.scope_ref,
    guidance: row.guidance,
    title: row.title,
    body: row.body,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    durationDays: row.duration_days,
    evidence: row.evidence,
    frequency: row.frequency,
    source: row.source,
    importance: row.importance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRecalledAt: row.last_recalled_at,
    recallCount: row.recall_count,
    retrievedCount: row.retrieved_count,
    supersededBy: row.superseded_by,
  };
}

export function buildPageWhere(opts: {
  query?: string;
  kind?: MemoryKind;
  subject?: MemorySubject;
  guidance?: MemoryGuidance;
  scopeKind?: MemoryScopeKind;
  scope?: MemoryScopeSearch;
  cursor: { updatedAt: string; id: string; retrievedCount?: number } | null;
  sort?: "recent" | "retrieved";
}): { sql: string; params: Record<string, SQLQueryBindings> } {
  const clauses: string[] = ["superseded_by IS NULL"];
  const params: Record<string, SQLQueryBindings> = {};
  if (opts.kind) {
    clauses.push("kind = $__kind");
    params.$__kind = opts.kind;
  }
  if (opts.subject) {
    clauses.push("subject = $__subject");
    params.$__subject = opts.subject;
  }
  if (opts.guidance) {
    clauses.push("guidance = $__guidance");
    params.$__guidance = opts.guidance;
  }
  if (opts.scopeKind) {
    clauses.push("scope_kind = $__scope_kind");
    params.$__scope_kind = opts.scopeKind;
  }
  addScopeClauses(opts.scope, clauses, params);
  const trimmed = opts.query?.trim();
  if (trimmed) {
    clauses.push("(LOWER(title) LIKE $__q OR LOWER(body) LIKE $__q)");
    params.$__q = `%${trimmed.toLowerCase()}%`;
  }
  if (opts.cursor) addCursorClause({ cursor: opts.cursor, sort: opts.sort }, clauses, params);
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

export function buildMemorySearchFilters(opts: {
  kinds?: readonly MemoryKind[];
  subjects?: readonly MemorySubject[];
  guidance?: readonly MemoryGuidance[];
  scope?: MemoryScopeSearch;
}, alias = "m"): { sql: string; params: Record<string, SQLQueryBindings>; filtered: boolean } {
  const prefix = alias ? `${alias}.` : "";
  const clauses: string[] = [];
  const params: Record<string, SQLQueryBindings> = {};
  addInClause(clauses, params, `${prefix}kind`, "kind", opts.kinds);
  addInClause(clauses, params, `${prefix}subject`, "subject", opts.subjects);
  addInClause(clauses, params, `${prefix}guidance`, "guidance", opts.guidance);
  addScopeClauses(opts.scope, clauses, params, prefix);
  return {
    sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "",
    params,
    filtered: clauses.length > 0,
  };
}

function addInClause<T extends string>(
  clauses: string[],
  params: Record<string, SQLQueryBindings>,
  column: string,
  paramPrefix: string,
  values: readonly T[] | undefined,
): void {
  if (!values?.length) return;
  const placeholders = values.map((_, i) => `$${paramPrefix}${i}`).join(", ");
  values.forEach((value, i) => {
    params[`$${paramPrefix}${i}`] = value;
  });
  clauses.push(`${column} IN (${placeholders})`);
}

function addScopeClauses(
  scope: MemoryScopeSearch | undefined,
  clauses: string[],
  params: Record<string, SQLQueryBindings>,
  prefix = "",
): void {
  if (!scope) return;
  const parts: string[] = [];
  if (scope.includeGlobal !== false) parts.push(`${prefix}scope_kind = 'global'`);
  if (scope.workspaceRef) {
    parts.push(`(${prefix}scope_kind = 'workspace' AND ${prefix}scope_ref = $scope_workspace_ref)`);
    params.$scope_workspace_ref = scope.workspaceRef;
  }
  if (scope.sessionRef) {
    parts.push(`(${prefix}scope_kind = 'session' AND ${prefix}scope_ref = $scope_session_ref)`);
    params.$scope_session_ref = scope.sessionRef;
  }
  clauses.push(parts.length ? `(${parts.join(" OR ")})` : "0");
}

function addCursorClause(
  opts: { cursor: { updatedAt: string; id: string; retrievedCount?: number }; sort?: "recent" | "retrieved" },
  clauses: string[],
  params: Record<string, SQLQueryBindings>,
): void {
  params.$__cur_at = opts.cursor.updatedAt;
  params.$__cur_id = opts.cursor.id;
  if (opts.sort === "retrieved") {
    clauses.push(
      "(retrieved_count < $__cur_retrieved OR (retrieved_count = $__cur_retrieved AND (updated_at < $__cur_at OR (updated_at = $__cur_at AND id < $__cur_id))))",
    );
    params.$__cur_retrieved = opts.cursor.retrievedCount ?? 0;
  } else {
    clauses.push("(updated_at < $__cur_at OR (updated_at = $__cur_at AND id < $__cur_id))");
  }
}
