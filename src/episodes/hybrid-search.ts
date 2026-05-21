import { Database } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import { vecToBlob } from "../memory/embed-text";
import { score } from "../memory/ranking";
import type { Reranker } from "../memory/rerank";
import { episodeEmbedText } from "./embed-text";
import type { AgentEpisodeEntry, EpisodeOutcome, EpisodeSearchOptions } from "./types";

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

interface FtsRow extends EpisodeRow {
  rowid: number;
  bm25: number;
}

interface VecRow extends EpisodeRow {
  rowid: number;
  distance: number;
}

interface RankedHit {
  row: EpisodeRow & { rowid: number };
  rank: number;
}

const RRF_K = 60;
const PER_RANKER_LIMIT = 30;
const RERANK_CANDIDATE_LIMIT = 30;

export interface EpisodeHybridSearchDeps {
  db: Database;
  embedder: Embedder;
  reranker: Reranker | null;
  rawQueries: readonly string[];
  ftsExpressions: readonly string[];
  opts: EpisodeSearchOptions;
  perQueryLimit: number;
}

export async function episodeHybridSearch(
  deps: EpisodeHybridSearchDeps,
): Promise<{ entries: AgentEpisodeEntry[]; recallIds: string[] }> {
  const { db, embedder, reranker, rawQueries, ftsExpressions, opts, perQueryLimit } = deps;
  const excludeFilter = buildExcludeFilter(opts.excludeIds);

  const perQuery = await Promise.all(
    rawQueries.map(async (raw, i) => {
      const ftsExpr = ftsExpressions[i];
      const [ftsHits, vecHits] = await Promise.all([
        runFts(db, ftsExpr, excludeFilter),
        embedder
          .embedQuery(raw)
          .then((vec) => runVec(db, vec, excludeFilter))
          .catch(() => [] as RankedHit[]),
      ]);
      return { ftsHits, vecHits };
    }),
  );

  const fused = new Map<number, { row: EpisodeRow & { rowid: number }; rrf: number }>();
  for (const { ftsHits, vecHits } of perQuery) {
    addToFusion(fused, ftsHits);
    addToFusion(fused, vecHits);
  }
  const candidates = [...fused.values()].sort((a, b) => b.rrf - a.rrf);
  const finalLimit = rawQueries.length * perQueryLimit;

  if (reranker?.available() && candidates.length > 0) {
    const reranked = await tryRerank(reranker, rawQueries, candidates);
    if (reranked) {
      const entries = reranked.slice(0, finalLimit).map((r) => rowToEpisode(r.row));
      return { entries, recallIds: entries.map((entry) => entry.id) };
    }
  }

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

  const entries = ranked.map((r) => rowToEpisode(r.row));
  return { entries, recallIds: entries.map((entry) => entry.id) };
}

async function tryRerank(
  reranker: Reranker,
  queries: readonly string[],
  candidates: readonly { row: EpisodeRow & { rowid: number }; rrf: number }[],
): Promise<{ row: EpisodeRow & { rowid: number }; score: number }[] | null> {
  const top = candidates.slice(0, RERANK_CANDIDATE_LIMIT);
  const docs = top.map((candidate) => episodeEmbedText(rowToEpisode(candidate.row)));
  const perQueryScores = await Promise.all(
    queries.map((query) => reranker.rerank(query, docs).catch(() => null)),
  );
  const usable = perQueryScores.filter(
    (scores): scores is number[] => Array.isArray(scores) && scores.length === top.length,
  );
  if (usable.length === 0) return null;

  const finalScores = top.map((_, docIdx) => {
    let max = -Infinity;
    for (const queryScores of usable) if (queryScores[docIdx] > max) max = queryScores[docIdx];
    return max;
  });
  return top
    .map((candidate, i) => ({ row: candidate.row, score: finalScores[i] }))
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
    sql: ` AND e.id NOT IN (${placeholders})`,
    params,
    count: excludeIds.length,
  };
}

function runFts(
  db: Database,
  ftsExpr: string,
  excludeFilter: ReturnType<typeof buildExcludeFilter>,
): RankedHit[] {
  const rows = db
    .query(
      `SELECT e.rowid AS rowid, e.*, bm25(agent_episodes_fts) AS bm25
         FROM agent_episodes_fts f
         JOIN agent_episodes e ON e.rowid = f.rowid
        WHERE agent_episodes_fts MATCH $match
          ${excludeFilter.sql}
        ORDER BY rank
        LIMIT $limit`,
    )
    .all({
      $match: ftsExpr,
      $limit: PER_RANKER_LIMIT,
      ...excludeFilter.params,
    } as never) as FtsRow[];
  return rows.map((row, rank) => ({ row, rank }));
}

function runVec(
  db: Database,
  embedding: Float32Array,
  excludeFilter: ReturnType<typeof buildExcludeFilter>,
): RankedHit[] {
  const k = PER_RANKER_LIMIT + excludeFilter.count;
  const rows = db
    .query(
      `SELECT e.rowid AS rowid, e.*, v.distance
         FROM agent_episodes_vec v
         JOIN agent_episodes e ON e.rowid = v.rowid
        WHERE v.embedding MATCH $vec
          AND k = $k
          ${excludeFilter.sql}
        ORDER BY v.distance`,
    )
    .all({
      $vec: vecToBlob(embedding),
      $k: k,
      ...excludeFilter.params,
    } as never) as VecRow[];
  return rows.slice(0, PER_RANKER_LIMIT).map((row, rank) => ({ row, rank }));
}

function addToFusion(
  fused: Map<number, { row: EpisodeRow & { rowid: number }; rrf: number }>,
  hits: readonly RankedHit[],
): void {
  for (const { row, rank } of hits) {
    const existing = fused.get(row.rowid);
    const contribution = 1 / (RRF_K + rank);
    if (existing) existing.rrf += contribution;
    else fused.set(row.rowid, { row, rrf: contribution });
  }
}

export function rowToEpisode(row: EpisodeRow): AgentEpisodeEntry {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    task: row.task,
    approach: row.approach,
    outcome: row.outcome,
    notes: row.notes,
    toolNames: parseJsonStringArray(row.tool_names),
    sourceSessionId: row.source_session_id,
    evidenceStartMessageId: row.evidence_start_message_id,
    evidenceEndMessageId: row.evidence_end_message_id,
    error: row.error,
    artifactIds: parseJsonStringArray(row.artifact_ids),
    importance: row.importance,
    seenCount: row.seen_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRecalledAt: row.last_recalled_at,
    recallCount: row.recall_count,
    retrievedCount: row.retrieved_count,
  };
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
