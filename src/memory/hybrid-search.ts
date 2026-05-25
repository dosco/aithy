import { Database } from "bun:sqlite";
import type { Embedder } from "./embed";
import { embedText, vecToBlob } from "./embed-text";
import { score } from "./ranking";
import type { Reranker } from "./rerank";
import type { MemoryEntry, MemoryGuidance, MemoryKind, MemoryScopeKind, MemorySearchOptions, MemorySubject } from "./types";
import { sourceStats, type RetrievalSourceStats } from "../retrieval/diagnostics";
import { addFusedHit, sortedFused, type FusedCandidate } from "../retrieval/fusion";
import type { LexicalSearchQuery, RetrievalLane } from "../retrieval/query-plan";
import { buildMemorySearchFilters, rowToEntry } from "./store-row";

interface MemoryRow {
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
  const filters = buildMemorySearchFilters(opts);
  const excludeFilter = buildExcludeFilter(opts.excludeIds);

  // Stage 1: candidate retrieval — FTS5 + vec KNN per query, in parallel.
  const [ftsGroups, vecGroups] = await Promise.all([
    Promise.all(ftsQueries.map((query) => Promise.resolve(runFts(db, query, filters, excludeFilter)))),
    Promise.all(rawQueries.map((raw) =>
      embedder
        .embedQuery(raw)
        .then((vec) => runVec(db, vec, filters, excludeFilter))
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
  const docs = top.map((c) => embedText(rowToEntry(c.item)));

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
  filters: ReturnType<typeof buildMemorySearchFilters>,
  excludeFilter: ReturnType<typeof buildExcludeFilter>,
): RankedHit[] {
  const rows = db
    .query(
      `SELECT m.rowid AS rowid, m.*, bm25(memories_fts) AS bm25
         FROM memories_fts f
         JOIN memories m ON m.rowid = f.rowid
        WHERE memories_fts MATCH $match
          AND m.superseded_by IS NULL
          ${filters.sql}
          ${excludeFilter.sql}
        ORDER BY rank
        LIMIT $limit`,
    )
    .all({
      $match: query.expression,
      $limit: PER_RANKER_LIMIT,
      ...filters.params,
      ...excludeFilter.params,
    } as never) as FtsRow[];
  return rows.map((row, rank) => ({ row, rank, lane: query.lane }));
}

function runVec(
  db: Database,
  embedding: Float32Array,
  filters: ReturnType<typeof buildMemorySearchFilters>,
  excludeFilter: ReturnType<typeof buildExcludeFilter>,
): RankedHit[] {
  // sqlite-vec applies KNN BEFORE the SQL WHERE filters, so we ask for extra
  // candidates and let the JOIN drop ones that don't match. We over-fetch by
  // (kind safety factor) + (exclude list size) to avoid coming up short.
  const k =
    PER_RANKER_LIMIT * (filters.filtered ? 3 : 1) + excludeFilter.count;
  const rows = db
    .query(
      `SELECT m.rowid AS rowid, m.*, v.distance
         FROM memories_vec v
         JOIN memories m ON m.rowid = v.rowid
        WHERE v.embedding MATCH $vec
          AND k = $k
          AND m.superseded_by IS NULL
          ${filters.sql}
          ${excludeFilter.sql}
        ORDER BY v.distance`,
    )
    .all({
      $vec: vecToBlob(embedding),
      $k: k,
      ...filters.params,
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
