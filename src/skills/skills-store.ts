import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { sessionMigrations, type SkillRow } from "../session/sqlite-session-schema";
import { applySqliteMigrations } from "../sqlite/migrations";
import {
  extractSkillLinks,
  normalizeSkillFiles,
  slugify,
  type SkillFileInput,
} from "./bundle";
export { formatSkillContent } from "./format";
export type {
  SkillEntry,
  SkillEventInput,
  SkillEventType,
  SkillFileEntry,
  SkillMatchKind,
  SkillResolvedMatch,
  SkillUpsert,
  SkillUsageEvent,
} from "./types";
import type {
  SkillEntry,
  SkillEventInput,
  SkillEventType,
  SkillFileEntry,
  SkillMatchKind,
  SkillResolvedMatch,
  SkillUpsert,
  SkillUsageEvent,
} from "./types";
import {
  addResolved,
  buildSkillsWhere,
  byteLength,
  hashText,
  normalizeName,
  parseStringArray,
  quoteForFts5,
  selectSkillColumns,
  shiftHeadingsToAtLeastH4,
} from "./skills-store-helpers";

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
    const files = normalizeSkillFiles(skill.files);
    const links = extractSkillLinks(skill.body, files);
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db
        .query(
          `
            INSERT INTO skills (
              id, name, description, when_to_use, content, allowed_tools, tags,
              disable_model_invocation, user_invocable, updated_at
            )
            VALUES (
              $id, $name, $description, $whenToUse, $content, $allowedTools,
              $tags, $disableModelInvocation, $userInvocable, $updatedAt
            )
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              when_to_use = excluded.when_to_use,
              content = excluded.content,
              allowed_tools = excluded.allowed_tools,
              tags = excluded.tags,
              disable_model_invocation = excluded.disable_model_invocation,
              user_invocable = excluded.user_invocable,
              updated_at = excluded.updated_at
          `,
        )
        .run({
          $id: skill.id,
          $name: skill.name,
          $description: skill.description,
          $whenToUse: skill.whenToUse ?? null,
          $content: skill.body,
          $allowedTools: skill.allowedTools,
          $tags: skill.tags,
          $disableModelInvocation: skill.disableModelInvocation ? 1 : 0,
          $userInvocable: skill.userInvocable === false ? 0 : 1,
          $updatedAt: updatedAt,
        });
      this.replaceFiles(skill.id, files, updatedAt);
      this.replaceLinks(skill.id, links);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
    return this.get(skill.id)!;
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
      .query(`SELECT ${selectSkillColumns()} FROM skills ORDER BY name`)
      .all() as SkillRow[];
    return rows.map((row) => this.entry(row));
  }

  get(id: string): SkillEntry | null {
    const row = this.db
      .query(
        `SELECT ${selectSkillColumns()}
         FROM skills
         WHERE id = $id`,
      )
      .get({ $id: id }) as SkillRow | undefined;
    return row ? this.entry(row) : null;
  }

  getByName(name: string): SkillEntry | null {
    const normalized = normalizeName(name);
    if (!normalized) return null;
    const rows = this.db
      .query(`SELECT ${selectSkillColumns()} FROM skills`)
      .all() as SkillRow[];
    const row = rows.find((item) => normalizeName(item.name) === normalized);
    return row ? this.entry(row) : null;
  }

  getByIds(ids: readonly string[]): SkillEntry[] {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return [];
    const rows = this.db
      .query(
        `SELECT ${selectSkillColumns()}
         FROM skills
         WHERE id IN (${uniqueIds.map(() => "?").join(", ")})`,
      )
      .all(...uniqueIds) as SkillRow[];
    const byId = new Map(rows.map((row) => [row.id, this.entry(row)]));
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
        `SELECT ${selectSkillColumns()}
         FROM skills
         ${where.sql}
         ORDER BY ${orderBy}
         LIMIT $__limit`,
      )
      .all({ ...where.params, $__limit: limit + 1 } as never) as SkillRow[];
    const more = rows.length > limit;
    const items = (more ? rows.slice(0, limit) : rows).map((row) => this.entry(row));
    const last = items[items.length - 1];
    const nextCursor = more && last
      ? { name: last.name, id: last.id, ...(sort === "retrieved" ? { retrievedCount: last.retrieved_count } : {}) }
      : null;
    return { items, nextCursor };
  }

  topRetrieved(limit: number): SkillEntry[] {
    const rows = this.db
      .query(
        `SELECT ${selectSkillColumns()}
         FROM skills
         ORDER BY retrieved_count DESC, name ASC, id ASC
         LIMIT $limit`,
      )
      .all({ $limit: Math.max(1, limit) }) as SkillRow[];
    return rows.map((row) => this.entry(row));
  }

  incrementRetrieved(ids: readonly string[]): void {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return;
    this.db
      .query(
        `UPDATE skills
         SET retrieved_count = retrieved_count + 1,
             last_retrieved_at = ?
         WHERE id IN (${uniqueIds.map(() => "?").join(", ")})`,
      )
      .run(new Date().toISOString(), ...uniqueIds);
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
          SELECT ${selectSkillColumns("s")}
          FROM skills_fts f
          JOIN skills s ON s.rowid = f.rowid
          WHERE skills_fts MATCH $match
          ORDER BY rank, s.used_count DESC, s.retrieved_count DESC, s.name ASC
          LIMIT $limit
        `,
      )
      .all({
        $match: matchExpr,
        $limit: sanitized.length * perQueryLimit,
      }) as SkillRow[];
    return rows.map((row) => this.entry(row));
  }

  resolveSearchQueries(queries: readonly string[], perQueryLimit = 3): SkillResolvedMatch[] {
    const matches: SkillResolvedMatch[] = [];
    const seen = new Set<string>();
    for (const raw of queries) {
      const query = raw.trim();
      if (!query) continue;
      const byId = this.get(query) ?? this.get(slugify(query));
      if (byId) {
        addResolved(matches, seen, byId, query, "id");
        continue;
      }
      const byName = this.getByName(query);
      if (byName) {
        addResolved(matches, seen, byName, query, "name");
        continue;
      }
      for (const skill of this.search([query], perQueryLimit)) {
        addResolved(matches, seen, skill, query, "search");
      }
    }
    return matches;
  }

  recordEvent(input: SkillEventInput): void {
    if (!this.get(input.skillId)) return;
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO skill_events (
          event_type, skill_id, session_id, task_id, stage, reason, query,
          match_kind, queries_json, created_at
        )
        VALUES (
          $eventType, $skillId, $sessionId, $taskId, $stage, $reason, $query,
          $matchKind, $queriesJson, $createdAt
        )`,
      )
      .run({
        $eventType: input.eventType,
        $skillId: input.skillId,
        $sessionId: input.sessionId ?? null,
        $taskId: input.taskId ?? null,
        $stage: input.stage ?? null,
        $reason: input.reason ?? null,
        $query: input.query ?? null,
        $matchKind: input.matchKind ?? null,
        $queriesJson: JSON.stringify([...(input.queries ?? [])]),
        $createdAt: now,
      });
    if (input.eventType === "used") {
      this.db
        .query(
          `UPDATE skills
           SET used_count = used_count + 1,
               last_used_at = $now
           WHERE id = $id`,
        )
        .run({ $now: now, $id: input.skillId });
    }
  }

  getFile(skillId: string, filePath: string): SkillFileEntry | null {
    const row = this.db
      .query("SELECT path, content, content_hash, bytes, updated_at FROM skill_files WHERE skill_id = $id AND path = $path")
      .get({ $id: skillId, $path: filePath }) as SkillFileRow | undefined;
    return row ? fileRowToEntry(row) : null;
  }

  recentUsage(skillId: string, limit = 5): SkillUsageEvent[] {
    const rows = this.db
      .query(
        `SELECT *
         FROM skill_events
         WHERE skill_id = $skillId AND event_type = 'used'
         ORDER BY id DESC
         LIMIT $limit`,
      )
      .all({ $skillId: skillId, $limit: Math.max(1, limit) }) as SkillEventRow[];
    return rows.map(eventRowToEntry);
  }

  private entry(row: SkillRow): SkillEntry {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      when_to_use: row.when_to_use,
      allowed_tools: row.allowed_tools,
      tags: row.tags,
      body: shiftHeadingsToAtLeastH4(row.content),
      files: this.files(row.id),
      links: this.links(row.id),
      recent_usage: this.recentUsage(row.id),
      retrieved_count: row.retrieved_count,
      used_count: row.used_count,
      disable_model_invocation: Boolean(row.disable_model_invocation),
      user_invocable: Boolean(row.user_invocable),
      last_retrieved_at: row.last_retrieved_at,
      last_used_at: row.last_used_at,
      updated_at: row.updated_at,
    };
  }

  private files(skillId: string): SkillFileEntry[] {
    const rows = this.db
      .query("SELECT path, content, content_hash, bytes, updated_at FROM skill_files WHERE skill_id = $id ORDER BY path")
      .all({ $id: skillId }) as SkillFileRow[];
    return rows.map(fileRowToEntry);
  }

  private links(skillId: string): string[] {
    const rows = this.db
      .query("SELECT target_skill_id FROM skill_links WHERE skill_id = $id ORDER BY target_skill_id")
      .all({ $id: skillId }) as Array<{ target_skill_id: string }>;
    return rows.map((row) => row.target_skill_id);
  }

  private replaceFiles(skillId: string, files: readonly SkillFileInput[], updatedAt: string): void {
    this.db.query("DELETE FROM skill_files WHERE skill_id = $id").run({ $id: skillId });
    const insert = this.db.query(
      `INSERT INTO skill_files (skill_id, path, content, content_hash, bytes, updated_at)
       VALUES ($skillId, $path, $content, $hash, $bytes, $updatedAt)`,
    );
    for (const file of files) {
      insert.run({
        $skillId: skillId,
        $path: file.path,
        $content: file.content,
        $hash: hashText(file.content),
        $bytes: byteLength(file.content),
        $updatedAt: updatedAt,
      });
    }
  }

  private replaceLinks(skillId: string, links: readonly string[]): void {
    this.db.query("DELETE FROM skill_links WHERE skill_id = $id").run({ $id: skillId });
    const insert = this.db.query(
      "INSERT OR IGNORE INTO skill_links (skill_id, target_skill_id) VALUES ($skillId, $targetSkillId)",
    );
    for (const link of links) insert.run({ $skillId: skillId, $targetSkillId: link });
  }

  close(): void {
    this.db.close();
  }
}

interface SkillFileRow {
  path: string;
  content: string;
  content_hash: string;
  bytes: number;
  updated_at: string;
}

interface SkillEventRow {
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

function fileRowToEntry(row: SkillFileRow): SkillFileEntry {
  return {
    path: row.path,
    content: row.content,
    content_hash: row.content_hash,
    bytes: row.bytes,
    updated_at: row.updated_at,
  };
}

function eventRowToEntry(row: SkillEventRow): SkillUsageEvent {
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
