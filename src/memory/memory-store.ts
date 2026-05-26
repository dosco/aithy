import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { memoryMigrations } from "./migrations";
import { score } from "./ranking";
import type { Embedder } from "./embed";
import { backfillEmbeddings as runBackfill, embedAndStore, indexMemoryEmbeddings, memoryEmbeddingStats, type BackfillResult } from "./embed-write";
import { hybridSearch } from "./hybrid-search";
import type { Reranker } from "./rerank";
import { tryLoadVecExtension } from "./vec-extension";
import { normalizeMemoryTiming } from "./time-bound";
import { buildMemorySearchFilters, buildPageWhere, rowToEntry, type MemoryRow } from "./store-row";
import { normalizeMemoryMetadata } from "./metadata";
import {
  retrievalDiagnostics,
  sourceStats,
  type RetrievalDiagnostics,
} from "../retrieval/diagnostics";
import { addFusedHit, sortedFused, type FusedCandidate } from "../retrieval/fusion";
import { buildRetrievalQueryPlan, type LexicalSearchQuery } from "../retrieval/query-plan";
import type { EmbeddingHealthStats, TargetIndexCounts } from "../retrieval/indexing";
import type { MemoryEntry, MemoryGuidance, MemoryKind, MemorySearchOptions, MemoryScopeKind, MemorySubject, MemoryUpsert } from "./types";
import { capBody, clamp01 } from "./store-utils";

type SearchRow = MemoryRow & { bm25: number };

const DEFAULT_PER_QUERY_LIMIT = 5;

export interface SqliteMemoryStoreOptions {
  embedder?: Embedder;
  reranker?: Reranker;
  log?: (msg: string) => void;
  inlineEmbeds?: boolean;
  onDirtyIndex?: (input: { memories: string[] }) => void;
}

export type { BackfillResult };

export class SqliteMemoryStore {
  private readonly db: Database;
  private readonly embedder: Embedder | null;
  private readonly reranker: Reranker | null;
  private readonly log: (msg: string) => void;
  private readonly inlineEmbeds: boolean;
  private readonly onDirtyIndex?: (input: { memories: string[] }) => void;
  private readonly vecEnabled: boolean;
  private readonly pendingEmbeds = new Set<Promise<unknown>>();

  constructor(dbPath: string, options: SqliteMemoryStoreOptions = {}) {
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
    this.onDirtyIndex = options.onDirtyIndex;

    const vecLoad = this.embedder ? tryLoadVecExtension(this.db, this.log) : { ok: false as const, reason: "no embedder" };

    applySqliteMigrations(this.db, "memory", memoryMigrations);

    this.vecEnabled = vecLoad.ok && this.tableExists("memories_vec");
  }

  isHybridReady(): boolean {
    return this.vecEnabled && (this.embedder?.available() ?? false);
  }

  isRerankReady(): boolean {
    return this.isHybridReady() && (this.reranker?.available() ?? false);
  }

  upsert(input: MemoryUpsert): MemoryEntry {
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const body = capBody(input.body);
    const importance = clamp01(input.importance ?? 0.5);
    const timing = normalizeMemoryTiming(input);
    const metadata = normalizeMemoryMetadata(input);
    this.db
      .query(
        `
          INSERT INTO memories (
            id, kind, subject, scope_kind, scope_ref, guidance,
            title, body, valid_from, valid_until, duration_days, evidence, frequency,
            source, importance, created_at, updated_at
          )
          VALUES (
            $id, $kind, $subject, $scopeKind, $scopeRef, $guidance,
            $title, $body, $validFrom, $validUntil, $durationDays, $evidence,
            $frequency, $source, $importance, $now, $now
          )
          ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            subject = excluded.subject,
            scope_kind = excluded.scope_kind,
            scope_ref = excluded.scope_ref,
            guidance = excluded.guidance,
            title = excluded.title,
            body = excluded.body,
            valid_from = excluded.valid_from,
            valid_until = excluded.valid_until,
            duration_days = excluded.duration_days,
            evidence = excluded.evidence,
            frequency = excluded.frequency,
            source = excluded.source,
            importance = excluded.importance,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        $id: id,
        $kind: input.kind,
        $subject: metadata.subject,
        $scopeKind: metadata.scopeKind,
        $scopeRef: metadata.scopeRef,
        $guidance: metadata.guidance,
        $title: input.title,
        $body: body,
        $validFrom: timing.validFrom,
        $validUntil: timing.validUntil,
        $durationDays: timing.durationDays,
        $evidence: timing.evidence,
        $frequency: timing.frequency,
        $source: input.source ?? null,
        $importance: importance,
        $now: now,
      });
    const entry = this.get(id)!;
    this.scheduleEmbed(entry);
    this.onDirtyIndex?.({ memories: [entry.id] });
    return entry;
  }

  supersede(oldId: string, replacement: MemoryUpsert): MemoryEntry {
    const replacementEntry = this.upsert(replacement);
    this.db
      .query("UPDATE memories SET superseded_by = $new, updated_at = $now WHERE id = $old")
      .run({ $new: replacementEntry.id, $old: oldId, $now: new Date().toISOString() });
    return replacementEntry;
  }

  delete(id: string): boolean {
    const rowidRow = this.db
      .query("SELECT rowid FROM memories WHERE id = $id")
      .get({ $id: id }) as { rowid: number } | undefined;
    const res = this.db.query("DELETE FROM memories WHERE id = $id").run({ $id: id });
    if (res.changes > 0 && rowidRow && this.vecEnabled) {
      // ON DELETE CASCADE handles memory_embed_meta. memories_vec is a virtual
      // table and doesn't honor cascades, so we delete explicitly.
      this.db.query("DELETE FROM memories_vec WHERE rowid = $rowid").run({ $rowid: rowidRow.rowid });
    }
    return res.changes > 0;
  }

  deleteExpired(nowDate: string): number {
    const rows = this.db
      .query("SELECT id FROM memories WHERE valid_until IS NOT NULL AND valid_until < $nowDate")
      .all({ $nowDate: nowDate }) as Array<{ id: string }>;
    let deleted = 0;
    for (const row of rows) if (this.delete(row.id)) deleted += 1;
    return deleted;
  }

  resetAll(): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.query("DELETE FROM memories").run();
      if (this.vecEnabled) {
        this.db.query("DELETE FROM memories_vec").run();
      }
      this.deleteTableRowsIfPresent("memory_embed_meta");
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  get(id: string): MemoryEntry | null {
    const row = this.db
      .query(`SELECT * FROM memories WHERE id = $id`)
      .get({ $id: id }) as MemoryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  count(opts: {
    query?: string;
    kind?: MemoryKind;
    subject?: MemorySubject;
    guidance?: MemoryGuidance;
    scopeKind?: MemoryScopeKind;
  } = {}): number {
    const where = buildPageWhere({ ...opts, cursor: null });
    const row = this.db
      .query(`SELECT COUNT(*) AS c FROM memories ${where.sql}`)
      .get(where.params as never) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  mostRecent(): MemoryEntry | null {
    const row = this.db
      .query(
        `SELECT * FROM memories
         WHERE superseded_by IS NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
      )
      .get() as MemoryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  page(opts: {
    cursor: { updatedAt: string; id: string; retrievedCount?: number } | null;
    limit: number;
    query?: string;
    kind?: MemoryKind;
    subject?: MemorySubject;
    guidance?: MemoryGuidance;
    scopeKind?: MemoryScopeKind;
    sort?: "recent" | "retrieved";
  }): { items: MemoryEntry[]; nextCursor: { updatedAt: string; id: string; retrievedCount?: number } | null } {
    const limit = Math.max(1, opts.limit);
    const sort = opts.sort ?? "recent";
    const where = buildPageWhere({
      query: opts.query,
      kind: opts.kind,
      subject: opts.subject,
      guidance: opts.guidance,
      scopeKind: opts.scopeKind,
      cursor: opts.cursor,
      sort,
    });
    const orderBy = sort === "retrieved"
      ? "retrieved_count DESC, updated_at DESC, id DESC"
      : "updated_at DESC, id DESC";
    const rows = this.db
      .query(
        `SELECT * FROM memories
         ${where.sql}
         ORDER BY ${orderBy}
         LIMIT $__limit`,
      )
      .all({ ...where.params, $__limit: limit + 1 } as never) as MemoryRow[];
    const more = rows.length > limit;
    const items = (more ? rows.slice(0, limit) : rows).map(rowToEntry);
    const last = items[items.length - 1];
    const nextCursor = more && last
      ? {
          updatedAt: last.updatedAt,
          id: last.id,
          ...(sort === "retrieved" ? { retrievedCount: last.retrievedCount } : {}),
        }
      : null;
    return { items, nextCursor };
  }

  rawCount(): number {
    const row = this.db.query("SELECT COUNT(*) AS c FROM memories").get() as
      | { c: number }
      | undefined;
    return row?.c ?? 0;
  }

  recent(limit: number): MemoryEntry[] {
    const rows = this.db
      .query(
        `SELECT * FROM memories
         WHERE superseded_by IS NULL
         ORDER BY updated_at DESC
         LIMIT $limit`,
      )
      .all({ $limit: limit }) as MemoryRow[];
    return rows.map(rowToEntry);
  }

  async search(queries: readonly string[], opts: MemorySearchOptions = {}): Promise<MemoryEntry[]> {
    return (await this.searchDetailed(queries, opts)).entries;
  }

  async searchDetailed(
    queries: readonly string[],
    opts: MemorySearchOptions = {},
  ): Promise<{ entries: MemoryEntry[]; diagnostics: RetrievalDiagnostics }> {
    const startedAt = performance.now();
    if (queries.length === 0) {
      return {
        entries: [],
        diagnostics: retrievalDiagnostics({
          source: "store",
          mode: "fts-only",
          queryCount: 0,
          startedAt,
          sources: [sourceStats({ source: "memories" })],
        }),
      };
    }
    const plan = buildRetrievalQueryPlan(queries);
    if (plan.lexicalQueries.length === 0) {
      return {
        entries: [],
        diagnostics: retrievalDiagnostics({
          source: "store",
          mode: "fts-only",
          queryCount: queries.length,
          startedAt,
          sources: [sourceStats({ source: "memories" })],
        }),
      };
    }

    const limit = opts.limit ?? DEFAULT_PER_QUERY_LIMIT;

    if (this.isHybridReady()) {
      const result = await hybridSearch({
        db: this.db,
        embedder: this.embedder!,
        reranker: this.reranker?.available() ? this.reranker : null,
        rawQueries: plan.semanticQueries,
        ftsQueries: plan.lexicalQueries,
        opts,
        perQueryLimit: limit,
      });
      if (opts.markRecalled !== false && result.recallIds.length > 0) this.markRecalled(result.recallIds);
      return {
        entries: result.entries,
        diagnostics: retrievalDiagnostics({
          source: "store",
          mode: result.reranked ? "hybrid-reranked" : "hybrid",
          queryCount: queries.length,
          rerankerAvailable: this.isRerankReady(),
          startedAt,
          sources: [result.stats],
        }),
      };
    }

    return this.searchFtsOnly(plan.lexicalQueries, opts, limit, queries.length, startedAt);
  }

  private searchFtsOnly(
    lexicalQueries: readonly LexicalSearchQuery[],
    opts: MemorySearchOptions,
    limit: number,
    queryCount: number,
    startedAt: number,
  ): { entries: MemoryEntry[]; diagnostics: RetrievalDiagnostics } {
    const filters = buildMemorySearchFilters(opts);
    const excludeFilter = opts.excludeIds?.length
      ? ` AND m.id NOT IN (${opts.excludeIds.map((_, i) => `$excl${i}`).join(", ")})`
      : "";

    const params: Record<string, SQLQueryBindings> = { ...filters.params };
    opts.excludeIds?.forEach((id, i) => {
      params[`$excl${i}`] = id;
    });

    const fused = new Map<string, FusedCandidate<SearchRow>>();
    let ftsCandidates = 0;
    for (const query of lexicalQueries) {
      const rows = this.db
        .query(
          `SELECT m.*, bm25(memories_fts) AS bm25
           FROM memories_fts f
           JOIN memories m ON m.rowid = f.rowid
           WHERE memories_fts MATCH $match
             AND m.superseded_by IS NULL
             ${filters.sql}
             ${excludeFilter}
           ORDER BY rank
           LIMIT $limit`,
        )
        .all({ ...params, $match: query.expression, $limit: 30 } as never) as SearchRow[];
      ftsCandidates += rows.length;
      rows.forEach((row, rank) => addFusedHit(fused, row.id, row, query.lane, rank));
    }

    const now = Date.now();
    const ranked = sortedFused(fused)
      .map((candidate) => ({
        entry: rowToEntry(candidate.item),
        score: score({
          bm25: -candidate.fusedScore,
          importance: candidate.item.importance,
          updatedAt: candidate.item.updated_at,
          now,
        }),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, lexicalQueries.length * limit);

    if (opts.markRecalled !== false && ranked.length > 0) {
      this.markRecalled(ranked.map((r) => r.entry.id));
    }
    const entries = ranked.map((r) => r.entry);
    return {
      entries,
      diagnostics: retrievalDiagnostics({
        source: "store",
        mode: "fts-only",
        queryCount,
        startedAt,
        sources: [sourceStats({
          source: "memories",
          ftsCandidates,
          fusedCandidates: fused.size,
          finalMatches: entries.length,
        })],
      }),
    };
  }

  async backfillEmbeddings(): Promise<BackfillResult> {
    if (!this.isHybridReady() || !this.embedder) return { done: 0, skipped: 0, indexed: [] };
    return runBackfill(this.db, this.embedder, this.log);
  }

  async indexEmbeddings(ids: readonly string[]): Promise<TargetIndexCounts> {
    if (!this.isHybridReady() || !this.embedder) return { indexed: 0, skipped: 0, missing: 0, failed: ids.length };
    return indexMemoryEmbeddings(this.db, this.embedder, ids, (id) => this.get(id));
  }

  embeddingStats(): EmbeddingHealthStats {
    return memoryEmbeddingStats(this.db, this.embedder);
  }

  async flushPendingEmbeds(): Promise<void> {
    while (this.pendingEmbeds.size > 0) {
      await Promise.all([...this.pendingEmbeds]);
    }
  }

  markRecalledIds(ids: readonly string[]): void {
    this.markRecalled(ids);
  }

  availableReranker(): Reranker | null {
    return this.reranker?.available() ? this.reranker : null;
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
        `UPDATE memories
         SET last_recalled_at = $now,
             recall_count = recall_count + 1,
             retrieved_count = retrieved_count + 1
         WHERE id IN (${placeholders})`,
      )
      .run(params as never);
  }

  private scheduleEmbed(entry: MemoryEntry): void {
    if (!this.inlineEmbeds) return;
    if (!this.isHybridReady() || !this.embedder) return;
    const embedder = this.embedder;
    const promise = embedAndStore(this.db, embedder, entry)
      .catch((err) => {
        this.log(`memory: inline embed failed for ${entry.id} — ${(err as Error).message}`);
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

  private deleteTableRowsIfPresent(name: string): void {
    try {
      this.db.query(`DELETE FROM ${name}`).run();
    } catch (error) {
      if (error instanceof Error && error.message.includes("no such table")) return;
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
