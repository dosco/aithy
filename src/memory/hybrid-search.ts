import { Database } from "bun:sqlite";
import type { Embedder } from "./embed";
import { embedText, vecToBlob } from "./embed-text";
import { score } from "./ranking";
import type { Reranker } from "./rerank";
import type { MemoryEntry, MemoryKind, MemorySearchOptions } from "./types";

interface MemoryRow {
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

interface FtsRow extends MemoryRow {
  rowid: number;
  bm25: number;
}

interface VecRow extends MemoryRow {
  rowid: number;
  distance: number;
}

interface RankedHit {
  row: MemoryRow & { rowid: number };
  rank: number;
}

const RRF_K = 60;
const PER_RANKER_LIMIT = 30;
const RERANK_CANDIDATE_LIMIT = 30;

export interface HybridSearchDeps {
  db: Database;
  embedder: Embedder;
  reranker: Reranker | null;
  rawQueries: readonly string[];
  ftsExpressions: readonly string[];
  opts: MemorySearchOptions;
  perQueryLimit: number;
}

export async function hybridSearch(
  deps: HybridSearchDeps,
): Promise<{ entries: MemoryEntry[]; recallIds: string[] }> {
  const { db, embedder, reranker, rawQueries, ftsExpressions, opts, perQueryLimit } = deps;
  const kindFilter = buildKindFilter(opts.kinds);
  const excludeFilter = buildExcludeFilter(opts.excludeIds);

  // Stage 1: candidate retrieval — FTS5 + vec KNN per query, in parallel.
  const perQuery = await Promise.all(
    rawQueries.map(async (raw, i) => {
      const ftsExpr = ftsExpressions[i];
      const [ftsHits, vecHits] = await Promise.all([
        runFts(db, ftsExpr, kindFilter, excludeFilter),
        embedder
          .embed(raw)
          .then((vec) => runVec(db, vec, kindFilter, excludeFilter))
          .catch(() => [] as RankedHit[]),
      ]);
      return { ftsHits, vecHits };
    }),
  );

  // Stage 2: RRF fusion across all rankers and queries.
  const fused = new Map<number, { row: MemoryRow & { rowid: number }; rrf: number }>();
  for (const { ftsHits, vecHits } of perQuery) {
    addToFusion(fused, ftsHits);
    addToFusion(fused, vecHits);
  }
  const candidates = [...fused.values()]
    .filter(({ row }) => row.superseded_by === null)
    .sort((a, b) => b.rrf - a.rrf);

  const finalLimit = rawQueries.length * perQueryLimit;

  // Stage 3 (optional): cross-encoder rerank of the top RRF candidates.
  // Falls back to RRF + importance/recency if reranker unavailable or fails.
  if (reranker?.available() && candidates.length > 0) {
    const reranked = await tryRerank(reranker, rawQueries, candidates);
    if (reranked) {
      const trimmed = reranked.slice(0, finalLimit);
      const entries = trimmed.map((r) => rowToEntry(r.row));
      return { entries, recallIds: entries.map((e) => e.id) };
    }
  }

  // Fallback: legacy RRF + importance × recency multiplier.
  const now = Date.now();
  const ranked = candidates
    .map(({ row, rrf }) => ({
      row,
      finalScore: score({
        bm25: -rrf,
        importance: row.importance,
        updatedAt: row.updated_at,
        now,
      }),
    }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, finalLimit);

  const entries = ranked.map((r) => rowToEntry(r.row));
  return { entries, recallIds: entries.map((e) => e.id) };
}

/**
 * Score the top RRF candidates against each query with the cross-encoder,
 * then take the max score per doc across queries. Returns null if every
 * rerank call failed — caller falls back to the RRF order.
 */
async function tryRerank(
  reranker: Reranker,
  queries: readonly string[],
  candidates: readonly { row: MemoryRow & { rowid: number }; rrf: number }[],
): Promise<{ row: MemoryRow & { rowid: number }; score: number }[] | null> {
  const top = candidates.slice(0, RERANK_CANDIDATE_LIMIT);
  const docs = top.map((c) => embedText({
    ...c.row,
    validFrom: c.row.valid_from,
    validUntil: c.row.valid_until,
    durationDays: c.row.duration_days,
    evidence: c.row.evidence,
    frequency: c.row.frequency,
  }));

  const perQueryScores = await Promise.all(
    queries.map((q) =>
      reranker.rerank(q, docs).catch(() => null),
    ),
  );

  const usable = perQueryScores.filter(
    (s): s is number[] => Array.isArray(s) && s.length === top.length,
  );
  if (usable.length === 0) return null;

  const finalScores = top.map((_, docIdx) => {
    let max = -Infinity;
    for (const queryScores of usable) {
      if (queryScores[docIdx] > max) max = queryScores[docIdx];
    }
    return max;
  });

  return top
    .map((c, i) => ({ row: c.row, score: finalScores[i] }))
    .sort((a, b) => b.score - a.score);
}

function buildKindFilter(kinds: readonly MemoryKind[] | undefined): {
  sql: string;
  params: Record<string, MemoryKind>;
} {
  if (!kinds?.length) return { sql: "", params: {} };
  const placeholders = kinds.map((_, i) => `$kind${i}`).join(", ");
  const params: Record<string, MemoryKind> = {};
  kinds.forEach((kind, i) => {
    params[`$kind${i}`] = kind;
  });
  return { sql: ` AND m.kind IN (${placeholders})`, params };
}

function buildExcludeFilter(excludeIds: readonly string[] | undefined): {
  sql: string;
  params: Record<string, string>;
  count: number;
} {
  if (!excludeIds?.length) return { sql: "", params: {}, count: 0 };
  const placeholders = excludeIds.map((_, i) => `$excl${i}`).join(", ");
  const params: Record<string, string> = {};
  excludeIds.forEach((id, i) => {
    params[`$excl${i}`] = id;
  });
  return {
    sql: ` AND m.id NOT IN (${placeholders})`,
    params,
    count: excludeIds.length,
  };
}

function runFts(
  db: Database,
  ftsExpr: string,
  kindFilter: ReturnType<typeof buildKindFilter>,
  excludeFilter: ReturnType<typeof buildExcludeFilter>,
): RankedHit[] {
  const rows = db
    .query(
      `SELECT m.rowid AS rowid, m.*, bm25(memories_fts) AS bm25
         FROM memories_fts f
         JOIN memories m ON m.rowid = f.rowid
        WHERE memories_fts MATCH $match
          AND m.superseded_by IS NULL
          ${kindFilter.sql}
          ${excludeFilter.sql}
        ORDER BY rank
        LIMIT $limit`,
    )
    .all({
      $match: ftsExpr,
      $limit: PER_RANKER_LIMIT,
      ...kindFilter.params,
      ...excludeFilter.params,
    } as never) as FtsRow[];
  return rows.map((row, rank) => ({ row, rank }));
}

function runVec(
  db: Database,
  embedding: Float32Array,
  kindFilter: ReturnType<typeof buildKindFilter>,
  excludeFilter: ReturnType<typeof buildExcludeFilter>,
): RankedHit[] {
  // sqlite-vec applies KNN BEFORE the SQL WHERE filters, so we ask for extra
  // candidates and let the JOIN drop ones that don't match. We over-fetch by
  // (kind safety factor) + (exclude list size) to avoid coming up short.
  const k =
    PER_RANKER_LIMIT * (kindFilter.sql ? 2 : 1) + excludeFilter.count;
  const rows = db
    .query(
      `SELECT m.rowid AS rowid, m.*, v.distance
         FROM memories_vec v
         JOIN memories m ON m.rowid = v.rowid
        WHERE v.embedding MATCH $vec
          AND k = $k
          AND m.superseded_by IS NULL
          ${kindFilter.sql}
          ${excludeFilter.sql}
        ORDER BY v.distance`,
    )
    .all({
      $vec: vecToBlob(embedding),
      $k: k,
      ...kindFilter.params,
      ...excludeFilter.params,
    } as never) as VecRow[];
  return rows.slice(0, PER_RANKER_LIMIT).map((row, rank) => ({ row, rank }));
}

function addToFusion(
  fused: Map<number, { row: MemoryRow & { rowid: number }; rrf: number }>,
  hits: readonly RankedHit[],
): void {
  for (const { row, rank } of hits) {
    const existing = fused.get(row.rowid);
    const contribution = 1 / (RRF_K + rank);
    if (existing) {
      existing.rrf += contribution;
    } else {
      fused.set(row.rowid, { row, rrf: contribution });
    }
  }
}

function rowToEntry(row: MemoryRow): MemoryEntry {
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
