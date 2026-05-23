import { createHash } from "node:crypto";
import type { SQLQueryBindings } from "bun:sqlite";
import type {
  SkillEntry,
  SkillEventType,
  SkillFileEntry,
  SkillMatchKind,
  SkillResolvedMatch,
  SkillUsageEvent,
} from "./types";

export const skillColumns = [
  "id",
  "name",
  "description",
  "when_to_use",
  "allowed_tools",
  "tags",
  "content",
  "retrieved_count",
  "used_count",
  "disable_model_invocation",
  "user_invocable",
  "source_kind",
  "source_id",
  "source_version",
  "source_hash",
  "disabled_at",
  "duplicated_from_source_id",
  "last_retrieved_at",
  "last_used_at",
  "updated_at",
] as const;

export function selectSkillColumns(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  return skillColumns.map((column) => `${prefix}${column}`).join(", ");
}

export function addResolved(
  matches: SkillResolvedMatch[],
  seen: Set<string>,
  skill: SkillEntry,
  query: string,
  matchKind: SkillMatchKind,
): void {
  if (seen.has(skill.id)) return;
  seen.add(skill.id);
  matches.push({ skill, query, matchKind });
}

export function isSkillAvailable(skill: { source_kind: string; disabled_at: string | null }): boolean {
  return !(skill.source_kind === "builtin" && skill.disabled_at);
}

export function activeSkillSql(alias = "s"): string {
  return `NOT (${alias}.source_kind = 'builtin' AND ${alias}.disabled_at IS NOT NULL)`;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function quoteForFts5(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return `"${cleaned}"`;
}

export function buildSkillsWhere(opts: {
  query?: string;
  cursor: { name: string; id: string; retrievedCount?: number } | null;
  sort?: "name" | "retrieved";
}): { sql: string; params: Record<string, SQLQueryBindings> } {
  const clauses: string[] = [];
  const params: Record<string, SQLQueryBindings> = {};
  const trimmed = opts.query?.trim();
  if (trimmed) {
    clauses.push(
      "(LOWER(name) LIKE $__q OR LOWER(description) LIKE $__q OR LOWER(IFNULL(when_to_use, '')) LIKE $__q OR LOWER(IFNULL(tags, '')) LIKE $__q)",
    );
    params.$__q = `%${trimmed.toLowerCase()}%`;
  }
  if (opts.cursor) {
    params.$__cur_name = opts.cursor.name;
    params.$__cur_id = opts.cursor.id;
    if (opts.sort === "retrieved") {
      clauses.push(
        "(retrieved_count < $__cur_retrieved OR (retrieved_count = $__cur_retrieved AND (name > $__cur_name OR (name = $__cur_name AND id > $__cur_id))))",
      );
      params.$__cur_retrieved = opts.cursor.retrievedCount ?? 0;
    } else {
      clauses.push("(name > $__cur_name OR (name = $__cur_name AND id > $__cur_id))");
    }
  }
  if (clauses.length === 0) return { sql: "", params };
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

export function shiftHeadingsToAtLeastH4(body: string): string {
  let minLevel = Infinity;
  for (const m of body.matchAll(/^(#{1,6})\s/gm)) minLevel = Math.min(minLevel, m[1].length);
  if (minLevel === Infinity || minLevel >= 4) return body;
  const shift = 4 - minLevel;
  return body.replace(/^(#{1,6})(\s)/gm, (_match, hashes: string, ws: string) => {
    const newLen = Math.min(6, hashes.length + shift);
    return "#".repeat(newLen) + ws;
  });
}

export interface SkillFileRow {
  path: string;
  content: string;
  content_hash: string;
  bytes: number;
  updated_at: string;
}

export interface SkillEventRow {
  id: number;
  event_type: SkillEventType;
  skill_id: string;
  session_id: string | null;
  task_id: string | null;
  stage: string | null;
  reason: string | null;
  query: string | null;
  match_kind: string | null;
  queries_json: string | null;
  created_at: string;
}

export function fileRowToEntry(row: SkillFileRow): SkillFileEntry {
  return {
    path: row.path,
    content: row.content,
    content_hash: row.content_hash,
    bytes: row.bytes,
    updated_at: row.updated_at,
  };
}

export function eventRowToEntry(row: SkillEventRow): SkillUsageEvent {
  return {
    id: row.id,
    event_type: row.event_type,
    skill_id: row.skill_id,
    session_id: row.session_id,
    task_id: row.task_id,
    stage: row.stage,
    reason: row.reason,
    query: row.query,
    match_kind: row.match_kind,
    queries: parseStringArray(row.queries_json),
    created_at: row.created_at,
  };
}
