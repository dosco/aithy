import { Database } from "bun:sqlite";
import type { Embedder } from "./embed";
import { embedText, vecToBlob } from "./embed-text";
import { score } from "./ranking";
import type { Reranker } from "./rerank";
import type { MemoryEntry, MemoryKind, MemorySearchOptions } from "./types";
import { sourceStats, type RetrievalSourceStats } from "../retrieval/diagnostics";
import { addFusedHit, sortedFused, type FusedCandidate } from "../retrieval/fusion";
import type { LexicalSearchQuery, RetrievalLane } from "../retrieval/query-plan";

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
  lane: RetrievalLane;
}

const PER_RANKER_LIMIT = 30;
const RERANK_CANDIDATE_LIMIT = 30;
const FUSED_CANDIDATE_LIMIT = 60;

export interface HybridSearchDeps {
  db: Database;
  embedder: Embedder;
  reranker: Reranker | null;
  rawQueries: readonly string[];
  ftsQueries: readonly LexicalSearchQuery[];
  opts: MemorySearchOptions;
  perQueryLimit: number;
}

export async function hybridSearch(
  deps: HybridSearchDeps,
): Promise<{ entries: MemoryEntry[]; recallIds: string[]; stats: RetrievalSourceStats; reranked: boolean }> {
  const { db, embedder, reranker, rawQueries, ftsQueries, opts, perQueryLimit } = deps;
  const kindFilter = buildKindFilter(opts.kinds);
  const excludeFilter = buildExcludeFilter(opts.excludeIds);

  // Stage 1: candidate retrieval — FTS5 + vec KNN per query, in parallel.
  const [ftsGroups, vecGroups] = await Promise.all([
    Promise.all(ftsQueries.map((query) => Promise.resolve(runFts(db, query, kindFilter, excludeFilter)))),
    Promise.all(rawQueries.map((raw) =>
      embedder
        .embedQuery(raw)
        .then((vec) => runVec(db, vec, kindFilter, excludeFilter))
        .catch(() => [] as RankedHit[]),
    )),
  ]);
  const ftsCandidates = ftsGroups.reduce((sum, hits) => sum + hits.length, 0);
  const vectorCandidates = vecGroups.reduce((sum, hits) => sum + hits.length, 0);

  // Stage 2: RRF fusion across all rankers and queries.
  const fused = new Map<number, FusedCandidate<MemoryRow & { rowid: number }>>();
  for (const hits of [...ftsGroups, ...vecGroups]) addToFusion(fused, hits);
  const candidates = sortedFused(fused)
    .filter(({ item }) => item.superseded_by === null)
    .slice(0, FUSED_CANDIDATE_LIMIT);

  const finalLimit = rawQueries.length * perQueryLimit;

  // Stage 3 (optional): cross-encoder rerank of the top RRF candidates.
  // Falls back to RRF + importance/recency if reranker unavailable or fails.
  if (reranker?.available() && candidates.length > 0) {
    const reranked = await tryRerank(reranker, rawQueries, candidates);
    if (reranked) {
      const trimmed = reranked.slice(0, finalLimit);
      const entries = trimmed.map((r) => rowToEntry(r.item));
      return {
        entries,
        recallIds: entries.map((e) => e.id),
        reranked: true,
        stats: sourceStats({
          source: "memories",
          ftsCandidates,
          vectorCandidates,
          fusedCandidates: candidates.length,
          finalMatches: entries.length,
        }),
      };
    }
  }

  // Fallback: legacy RRF + importance × recency multiplier.
  const now = Date.now();
  const ranked = candidates
    .map((candidate) => ({
      row: candidate.item,
      finalScore: score({
        bm25: -candidate.fusedScore,
        importance: candidate.item.importance,
        updatedAt: candidate.item.updated_at,
        now,
      }),
    }))
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, finalLimit);

  const entries = ranked.map((r) => rowToEntry(r.row));
  return {
    entries,
    recallIds: entries.map((e) => e.id),
    reranked: false,
    stats: sourceStats({
      source: "memories",
      ftsCandidates,
      vectorCandidates,
      fusedCandidates: candidates.length,
      finalMatches: entries.length,
    }),
  };
}

/**
 * Score the top RRF candidates against each query with the cross-encoder,
 * then take the max score per doc across queries. Returns null if every
 * rerank call failed — caller falls back to the RRF order.
 */
async function tryRerank(
  reranker: Reranker,
  queries: readonly string[],
  candidates: readonly FusedCandidate<MemoryRow & { rowid: number }>[],
): Promise<Array<FusedCandidate<MemoryRow & { rowid: number }> & { score: number }> | null> {
  const top = candidates.slice(0, RERANK_CANDIDATE_LIMIT);
  const docs = top.map((c) => embedText({
    ...c.item,
    validFrom: c.item.valid_from,
    validUntil: c.item.valid_until,
    durationDays: c.item.duration_days,
    evidence: c.item.evidence,
    frequency: c.item.frequency,
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
    .map((c, i) => ({ ...c, score: finalScores[i] }))
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
  query: LexicalSearchQuery,
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
      $match: query.expression,
      $limit: PER_RANKER_LIMIT,
      ...kindFilter.params,
      ...excludeFilter.params,
    } as never) as FtsRow[];
  return rows.map((row, rank) => ({ row, rank, lane: query.lane }));
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
  return rows.slice(0, PER_RANKER_LIMIT).map((row, rank) => ({ row, rank, lane: "semantic" }));
}

function addToFusion(
  fused: Map<number, FusedCandidate<MemoryRow & { rowid: number }>>,
  hits: readonly RankedHit[],
): void {
  for (const { row, rank, lane } of hits) {
    addFusedHit(fused, row.rowid, row, lane, rank);
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
