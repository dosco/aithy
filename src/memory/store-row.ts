import type { SQLQueryBindings } from "bun:sqlite";
import type { MemoryEntry, MemoryKind } from "./types";

export interface MemoryRow {
  id: string;
  kind: MemoryKind;
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
  cursor: { updatedAt: string; id: string; retrievedCount?: number } | null;
  sort?: "recent" | "retrieved";
}): { sql: string; params: Record<string, SQLQueryBindings> } {
  const clauses: string[] = ["superseded_by IS NULL"];
  const params: Record<string, SQLQueryBindings> = {};
  if (opts.kind) {
    clauses.push("kind = $__kind");
    params.$__kind = opts.kind;
  }
  const trimmed = opts.query?.trim();
  if (trimmed) {
    clauses.push("(LOWER(title) LIKE $__q OR LOWER(body) LIKE $__q)");
    params.$__q = `%${trimmed.toLowerCase()}%`;
  }
  if (opts.cursor) addCursorClause({ cursor: opts.cursor, sort: opts.sort }, clauses, params);
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
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
