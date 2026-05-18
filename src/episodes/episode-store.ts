import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import type { Reranker } from "../memory/rerank";
import { score } from "../memory/ranking";
import { tryLoadVecExtension } from "../memory/vec-extension";
import { applySqliteMigrations } from "../sqlite/migrations";
import { episodeMigrations } from "./migrations";
import { embedAndStoreEpisode, backfillEpisodeEmbeddings, type EpisodeBackfillResult } from "./embed-write";
import { episodeHybridSearch, rowToEpisode } from "./hybrid-search";
import type { AgentEpisodeEntry, AgentEpisodeUpsert, EpisodeOutcome, EpisodeSearchOptions } from "./types";

interface EpisodeRow {
  id: string;
  dedupe_key: string;
  task: string;
  approach: string;
  outcome: EpisodeOutcome;
  notes: string;
  tool_names: string;
  source_session_id: string;
  evidence_start_message_id: number;
  evidence_end_message_id: number;
  error: string | null;
  artifact_ids: string;
  importance: number;
  seen_count: number;
  created_at: string;
  updated_at: string;
  last_recalled_at: string | null;
  recall_count: number;
  retrieved_count: number;
}

interface SearchRow extends EpisodeRow {
  bm25: number;
}

export interface SqliteEpisodeStoreOptions {
  embedder?: Embedder;
  reranker?: Reranker;
  log?: (msg: string) => void;
  inlineEmbeds?: boolean;
}

const DEFAULT_PER_QUERY_LIMIT = 3;
const MAX_TEXT_CHARS = 4_000;

export class SqliteEpisodeStore {
  private readonly db: Database;
  private readonly embedder: Embedder | null;
  private readonly reranker: Reranker | null;
  private readonly log: (msg: string) => void;
  private readonly inlineEmbeds: boolean;
  private readonly vecEnabled: boolean;
  private readonly pendingEmbeds = new Set<Promise<void>>();

  constructor(dbPath: string, options: SqliteEpisodeStoreOptions = {}) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");

    this.embedder = options.embedder ?? null;
    this.reranker = options.reranker ?? null;
    this.log = options.log ?? (() => {});
    this.inlineEmbeds = options.inlineEmbeds ?? true;

    const vecLoad = this.embedder ? tryLoadVecExtension(this.db, this.log) : { ok: false as const, reason: "no embedder" };
    applySqliteMigrations(this.db, "episodes", episodeMigrations);
    this.vecEnabled = vecLoad.ok && this.tableExists("agent_episodes_vec");
  }

  cursor(): number {
    const row = this.db
      .query("SELECT last_message_id FROM episode_extraction_state WHERE key = 'cursor'")
      .get() as { last_message_id: number } | undefined;
    return row?.last_message_id ?? 0;
  }

  setCursor(messageId: number): void {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE episode_extraction_state
         SET last_message_id = MAX(last_message_id, $messageId), updated_at = $now
         WHERE key = 'cursor'`,
      )
      .run({ $messageId: Math.max(0, Math.floor(messageId)), $now: now });
  }

  isHybridReady(): boolean {
    return this.vecEnabled && (this.embedder?.available() ?? false);
  }

  isRerankReady(): boolean {
    return this.isHybridReady() && (this.reranker?.available() ?? false);
  }

  upsert(input: AgentEpisodeUpsert): AgentEpisodeEntry {
    const now = new Date().toISOString();
    const canonicalText = input.canonicalText?.trim() || `${input.task}\n${input.approach}`;
    const dedupeKey = normalizeDedupeKey(canonicalText);
    const existing = this.getByDedupeKey(dedupeKey);
    if (existing) {
      this.db
        .query(
          `UPDATE agent_episodes
           SET task = $task,
               approach = $approach,
               outcome = $outcome,
               notes = $notes,
               tool_names = $toolNames,
               source_session_id = $sourceSessionId,
               evidence_start_message_id = $evidenceStartMessageId,
               evidence_end_message_id = $evidenceEndMessageId,
               error = $error,
               artifact_ids = $artifactIds,
               importance = $importance,
               seen_count = seen_count + 1,
               updated_at = $now
           WHERE id = $id`,
        )
        .run(bindUpsert({ ...input, id: existing.id, dedupeKey, now }) as never);
      const entry = this.get(existing.id)!;
      this.scheduleEmbed(entry);
      return entry;
    }

    const id = `episode_${crypto.randomUUID()}`;
    this.db
      .query(
        `INSERT INTO agent_episodes (
          id, dedupe_key, task, approach, outcome, notes, tool_names,
          source_session_id, evidence_start_message_id, evidence_end_message_id,
          error, artifact_ids, importance, created_at, updated_at
        )
        VALUES (
          $id, $dedupeKey, $task, $approach, $outcome, $notes, $toolNames,
          $sourceSessionId, $evidenceStartMessageId, $evidenceEndMessageId,
          $error, $artifactIds, $importance, $now, $now
        )`,
      )
      .run(bindUpsert({ ...input, id, dedupeKey, now }) as never);
    const entry = this.get(id)!;
    this.scheduleEmbed(entry);
    return entry;
  }

  get(id: string): AgentEpisodeEntry | null {
    const row = this.db
      .query("SELECT * FROM agent_episodes WHERE id = $id")
      .get({ $id: id }) as EpisodeRow | undefined;
    return row ? rowToEpisode(row) : null;
  }

  getByDedupeKey(dedupeKey: string): AgentEpisodeEntry | null {
    const row = this.db
      .query("SELECT * FROM agent_episodes WHERE dedupe_key = $dedupeKey")
      .get({ $dedupeKey: dedupeKey }) as EpisodeRow | undefined;
    return row ? rowToEpisode(row) : null;
  }

  count(): number {
    const row = this.db.query("SELECT COUNT(*) AS c FROM agent_episodes").get() as { c: number } | undefined;
    return row?.c ?? 0;
  }

  recent(limit: number): AgentEpisodeEntry[] {
    const rows = this.db
      .query(
        `SELECT * FROM agent_episodes
         ORDER BY updated_at DESC
         LIMIT $limit`,
      )
      .all({ $limit: Math.max(1, limit) }) as EpisodeRow[];
    return rows.map(rowToEpisode);
  }

  async search(queries: readonly string[], opts: EpisodeSearchOptions = {}): Promise<AgentEpisodeEntry[]> {
    if (queries.length === 0) return [];
    const sanitized = queries.map(quoteForFts5).filter((query): query is string => query.length > 0);
    if (sanitized.length === 0) return [];

    const limit = opts.limit ?? DEFAULT_PER_QUERY_LIMIT;
    if (this.isHybridReady()) {
      const result = await episodeHybridSearch({
        db: this.db,
        embedder: this.embedder!,
        reranker: this.reranker?.available() ? this.reranker : null,
        rawQueries: queries,
        ftsExpressions: sanitized,
        opts,
        perQueryLimit: limit,
      });
      if (opts.markRecalled !== false && result.recallIds.length > 0) this.markRecalled(result.recallIds);
      return result.entries;
    }

    return this.searchFtsOnly(sanitized, opts, limit);
  }

  async backfillEmbeddings(): Promise<EpisodeBackfillResult> {
    if (!this.isHybridReady() || !this.embedder) return { done: 0, skipped: 0, indexed: [] };
    return backfillEpisodeEmbeddings(this.db, this.embedder, this.log);
  }

  async flushPendingEmbeds(): Promise<void> {
    while (this.pendingEmbeds.size > 0) {
      await Promise.all([...this.pendingEmbeds]);
    }
  }

  resetAll(): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.query("DELETE FROM agent_episodes").run();
      this.db.query("UPDATE episode_extraction_state SET last_message_id = 0, updated_at = $now WHERE key = 'cursor'")
        .run({ $now: new Date().toISOString() });
      this.deleteVecRowsIfPresent();
      this.deleteTableRowsIfPresent("agent_episode_embed_meta");
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private searchFtsOnly(
    sanitized: readonly string[],
    opts: EpisodeSearchOptions,
    limit: number,
  ): AgentEpisodeEntry[] {
    const matchExpr = sanitized.join(" OR ");
    const excludeFilter = opts.excludeIds?.length
      ? ` AND e.id NOT IN (${opts.excludeIds.map((_, i) => `$excl${i}`).join(", ")})`
      : "";
    const params: Record<string, SQLQueryBindings> = {
      $match: matchExpr,
      $limit: sanitized.length * limit * 2,
    };
    opts.excludeIds?.forEach((id, i) => {
      params[`$excl${i}`] = id;
    });

    const rows = this.db
      .query(
        `SELECT e.*, bm25(agent_episodes_fts) AS bm25
         FROM agent_episodes_fts f
         JOIN agent_episodes e ON e.rowid = f.rowid
         WHERE agent_episodes_fts MATCH $match
           ${excludeFilter}
         ORDER BY rank
         LIMIT $limit`,
      )
      .all(params as never) as SearchRow[];

    const now = Date.now();
    const ranked = rows
      .map((row) => ({
        entry: rowToEpisode(row),
        score: score({
          bm25: row.bm25,
          importance: row.importance,
          updatedAt: row.updated_at,
          now,
        }),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, sanitized.length * limit);

    if (opts.markRecalled !== false && ranked.length > 0) {
      this.markRecalled(ranked.map((rank) => rank.entry.id));
    }
    return ranked.map((rank) => rank.entry);
  }

  private markRecalled(ids: readonly string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = ids.map((_, i) => `$id${i}`).join(", ");
    const params: Record<string, SQLQueryBindings> = { $now: now };
    ids.forEach((id, i) => {
      params[`$id${i}`] = id;
    });
    this.db
      .query(
        `UPDATE agent_episodes
         SET last_recalled_at = $now,
             recall_count = recall_count + 1,
             retrieved_count = retrieved_count + 1
         WHERE id IN (${placeholders})`,
      )
      .run(params as never);
  }

  private scheduleEmbed(entry: AgentEpisodeEntry): void {
    if (!this.inlineEmbeds) return;
    if (!this.isHybridReady() || !this.embedder) return;
    const embedder = this.embedder;
    const promise = embedAndStoreEpisode(this.db, embedder, entry)
      .catch((error) => {
        this.log(`episodes: inline embed failed for ${entry.id} - ${(error as Error).message}`);
      })
      .finally(() => {
        this.pendingEmbeds.delete(promise);
      });
    this.pendingEmbeds.add(promise);
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .query("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = $name")
      .get({ $name: name }) as { name: string } | undefined;
    return row !== undefined;
  }

  private deleteVecRowsIfPresent(): void {
    if (!this.tableExists("agent_episodes_vec")) return;
    if (!this.vecEnabled) {
      const loaded = tryLoadVecExtension(this.db, this.log);
      if (!loaded.ok) {
        this.log(`episodes: could not clear vec rows during reset - ${loaded.reason}`);
        return;
      }
    }
    this.db.query("DELETE FROM agent_episodes_vec").run();
  }

  private deleteTableRowsIfPresent(name: string): void {
    try {
      this.db.query(`DELETE FROM ${name}`).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes("no such table")) return;
      throw error;
    }
  }
}

function bindUpsert(input: AgentEpisodeUpsert & { id: string; dedupeKey: string; now: string }): Record<string, SQLQueryBindings> {
  return {
    $id: input.id,
    $dedupeKey: input.dedupeKey,
    $task: cap(input.task.trim(), 300),
    $approach: cap(input.approach.trim(), MAX_TEXT_CHARS),
    $outcome: input.outcome,
    $notes: cap(input.notes?.trim() ?? "", MAX_TEXT_CHARS),
    $toolNames: JSON.stringify(cleanStringArray(input.toolNames)),
    $sourceSessionId: input.sourceSessionId,
    $evidenceStartMessageId: Math.max(0, Math.floor(input.evidenceStartMessageId)),
    $evidenceEndMessageId: Math.max(0, Math.floor(input.evidenceEndMessageId)),
    $error: input.error ? cap(input.error.trim(), 1_000) : null,
    $artifactIds: JSON.stringify(cleanStringArray(input.artifactIds)),
    $importance: clamp01(input.importance ?? 0.5),
    $now: input.now,
  };
}

function normalizeDedupeKey(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

function cleanStringArray(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 20);
}

function cap(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)} [truncated]`;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function quoteForFts5(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return `"${cleaned}"`;
}
