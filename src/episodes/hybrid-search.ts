import { Database } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import { vecToBlob } from "../memory/embed-text";
import { score } from "../memory/ranking";
import type { Reranker } from "../memory/rerank";
import { sourceStats, type RetrievalSourceStats } from "../retrieval/diagnostics";
import { addFusedHit, sortedFused, type FusedCandidate } from "../retrieval/fusion";
import type { LexicalSearchQuery, RetrievalLane } from "../retrieval/query-plan";
import { episodeEmbedText, episodeHash } from "./embed-text";
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
  body_hash: string;
  model_id: string;
  dim: number;
}

interface RankedHit {
  row: EpisodeRow & { rowid: number };
  rank: number;
  lane: RetrievalLane;
}

const PER_RANKER_LIMIT = 30;
const RERANK_CANDIDATE_LIMIT = 30;
const FUSED_CANDIDATE_LIMIT = 60;

export interface EpisodeHybridSearchDeps {
  db: Database;
  embedder: Embedder;
  reranker: Reranker | null;
  rawQueries: readonly string[];
  ftsQueries: readonly LexicalSearchQuery[];
  opts: EpisodeSearchOptions;
  perQueryLimit: number;
}

export async function episodeHybridSearch(
  deps: EpisodeHybridSearchDeps,
): Promise<{ entries: AgentEpisodeEntry[]; recallIds: string[]; stats: RetrievalSourceStats; reranked: boolean }> {
  const { db, embedder, reranker, rawQueries, ftsQueries, opts, perQueryLimit } = deps;
  const excludeFilter = buildExcludeFilter(opts.excludeIds);

  const [ftsGroups, vecGroups] = await Promise.all([
    Promise.all(ftsQueries.map((query) => Promise.resolve(runFts(db, query, excludeFilter)))),
    Promise.all(rawQueries.map((raw) =>
      embedder
        .embedQuery(raw)
        .then((vec) => runVec(db, embedder, vec, excludeFilter))
        .catch(() => [] as RankedHit[]),
    )),
  ]);
  const ftsCandidates = ftsGroups.reduce((sum, hits) => sum + hits.length, 0);
  const vectorCandidates = vecGroups.reduce((sum, hits) => sum + hits.length, 0);

  const fused = new Map<number, FusedCandidate<EpisodeRow & { rowid: number }>>();
  for (const hits of [...ftsGroups, ...vecGroups]) addToFusion(fused, hits);
  const candidates = sortedFused(fused).slice(0, FUSED_CANDIDATE_LIMIT);
  const finalLimit = rawQueries.length * perQueryLimit;

  if (reranker?.available() && candidates.length > 0) {
    const reranked = await tryRerank(reranker, rawQueries, candidates);
    if (reranked) {
      const entries = reranked.slice(0, finalLimit).map((r) => rowToEpisode(r.item));
      return {
        entries,
        recallIds: entries.map((entry) => entry.id),
        reranked: true,
        stats: sourceStats({
          source: "episodes",
          ftsCandidates,
          vectorCandidates,
          fusedCandidates: candidates.length,
          finalMatches: entries.length,
        }),
      };
    }
  }

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

  const entries = ranked.map((r) => rowToEpisode(r.row));
  return {
    entries,
    recallIds: entries.map((entry) => entry.id),
    reranked: false,
    stats: sourceStats({
      source: "episodes",
      ftsCandidates,
      vectorCandidates,
      fusedCandidates: candidates.length,
      finalMatches: entries.length,
    }),
  };
}

async function tryRerank(
  reranker: Reranker,
  queries: readonly string[],
  candidates: readonly FusedCandidate<EpisodeRow & { rowid: number }>[],
): Promise<Array<FusedCandidate<EpisodeRow & { rowid: number }> & { score: number }> | null> {
  const top = candidates.slice(0, RERANK_CANDIDATE_LIMIT);
  const docs = top.map((candidate) => episodeEmbedText(rowToEpisode(candidate.item)));
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
    .map((candidate, i) => ({ ...candidate, score: finalScores[i] }))
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
  query: LexicalSearchQuery,
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
      $match: query.expression,
      $limit: PER_RANKER_LIMIT,
      ...excludeFilter.params,
    } as never) as FtsRow[];
  return rows.map((row, rank) => ({ row, rank, lane: query.lane }));
}

function runVec(
  db: Database,
  embedder: Embedder,
  embedding: Float32Array,
  excludeFilter: ReturnType<typeof buildExcludeFilter>,
): RankedHit[] {
  const k = PER_RANKER_LIMIT + excludeFilter.count;
  const rows = db
    .query(
      `SELECT e.rowid AS rowid, e.*, v.distance
              , meta.body_hash, meta.model_id, meta.dim
         FROM agent_episodes_vec v
         JOIN agent_episodes e ON e.rowid = v.rowid
         JOIN agent_episode_embed_meta meta ON meta.episode_id = e.id
        WHERE v.embedding MATCH $vec
          AND k = $k
          AND meta.model_id = $modelId
          AND meta.dim = $dim
          ${excludeFilter.sql}
        ORDER BY v.distance`,
    )
    .all({
      $vec: vecToBlob(embedding),
      $k: k,
      $modelId: embedder.modelId,
      $dim: embedder.dim,
      ...excludeFilter.params,
    } as never) as VecRow[];
  return rows
    .filter((row) => row.body_hash === episodeHash(episodeEmbedText(rowToEpisode(row))))
    .slice(0, PER_RANKER_LIMIT)
    .map((row, rank) => ({ row, rank, lane: "semantic" }));
}

function addToFusion(
  fused: Map<number, FusedCandidate<EpisodeRow & { rowid: number }>>,
  hits: readonly RankedHit[],
): void {
  for (const { row, rank, lane } of hits) addFusedHit(fused, row.rowid, row, lane, rank);
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
