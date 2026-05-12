import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { sessionMigrations, type SkillRow } from "../session/sqlite-session-schema";
import { applySqliteMigrations } from "../sqlite/migrations";

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  allowed_tools: string | null;
  tags: string | null;
  body: string;
  retrieved_count: number;
  updated_at: string;
}

export interface SkillUpsert {
  id: string;
  name: string;
  description: string;
  body: string;
  allowedTools: string | null;
  tags: string | null;
}

export class SqliteSkillsStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "session", sessionMigrations);
  }

  upsert(skill: SkillUpsert): SkillEntry {
    const updatedAt = new Date().toISOString();
    this.db
      .query(
        `
          INSERT INTO skills (id, name, description, content, allowed_tools, tags, updated_at)
          VALUES ($id, $name, $description, $content, $allowedTools, $tags, $updatedAt)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            content = excluded.content,
            allowed_tools = excluded.allowed_tools,
            tags = excluded.tags,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        $id: skill.id,
        $name: skill.name,
        $description: skill.description,
        $content: skill.body,
        $allowedTools: skill.allowedTools,
        $tags: skill.tags,
        $updatedAt: updatedAt,
      });
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: shiftHeadingsToAtLeastH4(skill.body),
      allowed_tools: skill.allowedTools,
      tags: skill.tags,
      retrieved_count: this.get(skill.id)?.retrieved_count ?? 0,
      updated_at: updatedAt,
    };
  }

  delete(id: string): boolean {
    const res = this.db.query("DELETE FROM skills WHERE id = $id").run({ $id: id });
    return res.changes > 0;
  }

  count(opts: { query?: string } = {}): number {
    const where = buildSkillsWhere({ query: opts.query, cursor: null });
    const row = this.db
      .query(`SELECT COUNT(*) AS c FROM skills ${where.sql}`)
      .get(where.params as never) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  countDistinctTools(): number {
    const rows = this.db
      .query("SELECT allowed_tools FROM skills WHERE allowed_tools IS NOT NULL")
      .all() as Array<{ allowed_tools: string | null }>;
    const set = new Set<string>();
    for (const row of rows) {
      if (!row.allowed_tools) continue;
      for (const tool of row.allowed_tools.split(/\s+/)) {
        if (tool) set.add(tool);
      }
    }
    return set.size;
  }

  getAll(): SkillEntry[] {
    const rows = this.db
      .query(
        "SELECT id, name, description, allowed_tools, tags, content, retrieved_count, updated_at FROM skills ORDER BY name",
      )
      .all() as SkillRow[];
    return rows.map(rowToEntry);
  }

  get(id: string): SkillEntry | null {
    const row = this.db
      .query(
        `SELECT id, name, description, allowed_tools, tags, content, retrieved_count, updated_at
         FROM skills
         WHERE id = $id`,
      )
      .get({ $id: id }) as SkillRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  getByIds(ids: readonly string[]): SkillEntry[] {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const rows = this.db
      .query(
        `SELECT id, name, description, allowed_tools, tags, content, retrieved_count, updated_at
         FROM skills
         WHERE id IN (${uniqueIds.map(() => "?").join(", ")})`,
      )
      .all(...uniqueIds) as SkillRow[];
    const byId = new Map(rows.map((row) => [row.id, rowToEntry(row)]));
    return uniqueIds.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
  }

  page(opts: {
    cursor: { name: string; id: string; retrievedCount?: number } | null;
    limit: number;
    query?: string;
    sort?: "name" | "retrieved";
  }): { items: SkillEntry[]; nextCursor: { name: string; id: string; retrievedCount?: number } | null } {
    const limit = Math.max(1, opts.limit);
    const sort = opts.sort ?? "name";
    const where = buildSkillsWhere({ query: opts.query, cursor: opts.cursor, sort });
    const orderBy = sort === "retrieved"
      ? "retrieved_count DESC, name ASC, id ASC"
      : "name ASC, id ASC";
    const rows = this.db
      .query(
        `SELECT id, name, description, allowed_tools, tags, content, retrieved_count, updated_at
         FROM skills
         ${where.sql}
         ORDER BY ${orderBy}
         LIMIT $__limit`,
      )
      .all({ ...where.params, $__limit: limit + 1 } as never) as SkillRow[];
    const more = rows.length > limit;
    const items = (more ? rows.slice(0, limit) : rows).map(rowToEntry);
    const last = items[items.length - 1];
    const nextCursor = more && last
      ? { name: last.name, id: last.id, ...(sort === "retrieved" ? { retrievedCount: last.retrieved_count } : {}) }
      : null;
    return { items, nextCursor };
  }

  topRetrieved(limit: number): SkillEntry[] {
    const rows = this.db
      .query(
        `SELECT id, name, description, allowed_tools, tags, content, retrieved_count, updated_at
         FROM skills
         ORDER BY retrieved_count DESC, name ASC, id ASC
         LIMIT $limit`,
      )
      .all({ $limit: Math.max(1, limit) }) as SkillRow[];
    return rows.map(rowToEntry);
  }

  incrementRetrieved(ids: readonly string[]): void {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return;
    this.db
      .query(
        `UPDATE skills
         SET retrieved_count = retrieved_count + 1
         WHERE id IN (${uniqueIds.map(() => "?").join(", ")})`,
      )
      .run(...uniqueIds);
  }

  search(queries: readonly string[], perQueryLimit = 3): SkillEntry[] {
    if (queries.length === 0) return [];
    const sanitized: string[] = [];
    for (const q of queries) {
      const quoted = quoteForFts5(q);
      if (quoted) sanitized.push(quoted);
    }
    if (sanitized.length === 0) return [];
    const matchExpr = sanitized.join(" OR ");
    const rows = this.db
      .query(
        `
          SELECT s.id, s.name, s.description, s.allowed_tools, s.tags, s.content, s.retrieved_count, s.updated_at
          FROM skills_fts f
          JOIN skills s ON s.rowid = f.rowid
          WHERE skills_fts MATCH $match
          ORDER BY rank
          LIMIT $limit
        `,
      )
      .all({
        $match: matchExpr,
        $limit: sanitized.length * perQueryLimit,
      }) as SkillRow[];
    return rows.map(rowToEntry);
  }

  close(): void {
    this.db.close();
  }
}

function rowToEntry(row: SkillRow): SkillEntry {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    allowed_tools: row.allowed_tools,
    tags: row.tags,
    body: shiftHeadingsToAtLeastH4(row.content),
    retrieved_count: row.retrieved_count,
    updated_at: row.updated_at,
  };
}

export function formatSkillContent(skill: SkillEntry): string {
  const parts: string[] = [`### ${skill.name}`];
  if (skill.description) parts.push(skill.description);
  if (skill.tags) parts.push(`**Tags:** ${skill.tags}`);
  if (skill.allowed_tools) parts.push(`**Allowed tools:** ${skill.allowed_tools}`);
  if (skill.body) parts.push(skill.body);
  return parts.join("\n\n");
}

function quoteForFts5(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return `"${cleaned}"`;
}

function buildSkillsWhere(opts: {
  query?: string;
  cursor: { name: string; id: string; retrievedCount?: number } | null;
  sort?: "name" | "retrieved";
}): { sql: string; params: Record<string, SQLQueryBindings> } {
  const clauses: string[] = [];
  const params: Record<string, SQLQueryBindings> = {};
  const trimmed = opts.query?.trim();
  if (trimmed) {
    clauses.push(
      "(LOWER(name) LIKE $__q OR LOWER(description) LIKE $__q OR LOWER(IFNULL(tags, '')) LIKE $__q)",
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
      clauses.push(
        "(name > $__cur_name OR (name = $__cur_name AND id > $__cur_id))",
      );
    }
  }
  if (clauses.length === 0) return { sql: "", params };
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

function shiftHeadingsToAtLeastH4(body: string): string {
  let minLevel = Infinity;
  for (const m of body.matchAll(/^(#{1,6})\s/gm)) {
    minLevel = Math.min(minLevel, m[1].length);
  }
  if (minLevel === Infinity || minLevel >= 4) return body;
  const shift = 4 - minLevel;
  return body.replace(/^(#{1,6})(\s)/gm, (_match, hashes: string, ws: string) => {
    const newLen = Math.min(6, hashes.length + shift);
    return "#".repeat(newLen) + ws;
  });
}
