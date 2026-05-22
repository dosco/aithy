import type { SqliteEpisodeStore } from "../episodes/episode-store";
import { episodeEmbedText } from "../episodes/embed-text";
import type { AgentEpisodeEntry } from "../episodes/types";
import { embedText as memoryEmbedText } from "../memory/embed-text";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { Reranker } from "../memory/rerank";
import type { MemoryEntry } from "../memory/types";
import {
  combineRetrievalMode,
  retrievalDiagnostics,
  sourceStats,
  type RetrievalDiagnostics,
} from "./diagnostics";

export type UnifiedRecallHit =
  | { source: "memory"; id: string; memory: MemoryEntry }
  | { source: "episode"; id: string; episode: AgentEpisodeEntry };

interface RankedRecallHit {
  hit: UnifiedRecallHit;
  fused: number;
}

export interface UnifiedRecallResult {
  hits: UnifiedRecallHit[];
  diagnostics: RetrievalDiagnostics;
}

export interface UnifiedRecallOptions {
  memory?: SqliteMemoryStore;
  episodes?: SqliteEpisodeStore;
  queries: readonly string[];
  excludeMemoryIds?: readonly string[];
  excludeEpisodeIds?: readonly string[];
  limit?: number;
  markRecalled?: boolean;
  source?: "preload" | "recall";
}

const DEFAULT_LIMIT = 8;
const PER_SOURCE_CANDIDATES = 16;

export async function unifiedMemoryRecall(opts: UnifiedRecallOptions): Promise<UnifiedRecallResult> {
  const startedAt = performance.now();
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const candidateLimit = Math.max(limit, PER_SOURCE_CANDIDATES);
  const queries = opts.queries.map((query) => query.trim()).filter(Boolean);
  if (queries.length === 0 || (!opts.memory && !opts.episodes)) {
    return {
      hits: [],
      diagnostics: retrievalDiagnostics({
        source: opts.source ?? "recall",
        mode: "fts-only",
        queryCount: queries.length,
        startedAt,
        sources: [],
      }),
    };
  }

  const [memoryResult, episodeResult] = await Promise.all([
    opts.memory ? searchMemory(opts.memory, queries, {
      limit: candidateLimit,
      excludeIds: opts.excludeMemoryIds,
      markRecalled: false,
    }) : undefined,
    opts.episodes ? searchEpisodes(opts.episodes, queries, {
      limit: candidateLimit,
      excludeIds: opts.excludeEpisodeIds,
      markRecalled: false,
    }) : undefined,
  ]);

  const candidates: RankedRecallHit[] = [
    ...(memoryResult?.entries ?? []).map((memory, rank): RankedRecallHit => ({
      hit: { source: "memory", id: memory.id, memory },
      fused: reciprocalRank(rank),
    })),
    ...(episodeResult?.entries ?? []).map((episode, rank): RankedRecallHit => ({
      hit: { source: "episode", id: episode.id, episode },
      fused: reciprocalRank(rank),
    })),
  ];
  const diagnostics = [memoryResult?.diagnostics, episodeResult?.diagnostics]
    .filter((item): item is RetrievalDiagnostics => Boolean(item));
  const reranker = opts.memory?.availableReranker?.() ?? opts.episodes?.availableReranker?.() ?? null;
  const { hits, reranked, errors } = await finalRank(candidates, queries, reranker, limit);

  if (opts.markRecalled !== false && hits.length > 0) {
    opts.memory?.markRecalledIds?.(hits.flatMap((hit) => hit.source === "memory" ? [hit.id] : []));
    opts.episodes?.markRecalledIds?.(hits.flatMap((hit) => hit.source === "episode" ? [hit.id] : []));
  }

  return {
    hits,
    diagnostics: retrievalDiagnostics({
      source: opts.source ?? "recall",
      mode: combineRetrievalMode(diagnostics, reranked),
      queryCount: queries.length,
      rerankerAvailable: Boolean(reranker),
      startedAt,
      sources: diagnostics.flatMap((item) => item.sources),
      errors,
    }),
  };
}

async function searchMemory(
  store: SqliteMemoryStore,
  queries: readonly string[],
  opts: { limit: number; excludeIds?: readonly string[]; markRecalled: boolean },
): Promise<{ entries: MemoryEntry[]; diagnostics: RetrievalDiagnostics }> {
  if (store.searchDetailed) return store.searchDetailed(queries, opts);
  const startedAt = performance.now();
  const entries = await store.search(queries, opts);
  return { entries, diagnostics: fallbackDiagnostics("memories", queries.length, entries.length, startedAt) };
}

async function searchEpisodes(
  store: SqliteEpisodeStore,
  queries: readonly string[],
  opts: { limit: number; excludeIds?: readonly string[]; markRecalled: boolean },
): Promise<{ entries: AgentEpisodeEntry[]; diagnostics: RetrievalDiagnostics }> {
  if (store.searchDetailed) return store.searchDetailed(queries, opts);
  const startedAt = performance.now();
  const entries = await store.search(queries, opts);
  return { entries, diagnostics: fallbackDiagnostics("episodes", queries.length, entries.length, startedAt) };
}

function fallbackDiagnostics(
  source: "memories" | "episodes",
  queryCount: number,
  finalMatches: number,
  startedAt: number,
): RetrievalDiagnostics {
  return retrievalDiagnostics({
    source: "store",
    mode: "fts-only",
    queryCount,
    startedAt,
    sources: [sourceStats({ source, finalMatches })],
  });
}

async function finalRank(
  candidates: readonly RankedRecallHit[],
  queries: readonly string[],
  reranker: Reranker | null,
  limit: number,
): Promise<{ hits: UnifiedRecallHit[]; reranked: boolean; errors: string[] }> {
  if (candidates.length === 0) return { hits: [], reranked: false, errors: [] };
  if (!reranker?.available()) return { hits: fusedFallback(candidates, limit), reranked: false, errors: [] };
  try {
    const docs = candidates.map((candidate) => recallDocText(candidate.hit));
    const scores = await reranker.rerank(queries.join("\n"), docs);
    if (scores.length !== candidates.length) throw new Error("reranker returned mismatched score count");
    return {
      hits: candidates
        .map((candidate, index) => ({ candidate, score: scores[index], tie: tieBreakScore(candidate.hit) }))
        .sort((a, b) => b.score - a.score || b.tie - a.tie)
        .slice(0, limit)
        .map((item) => item.candidate.hit),
      reranked: true,
      errors: [],
    };
  } catch (error) {
    return {
      hits: fusedFallback(candidates, limit),
      reranked: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function fusedFallback(candidates: readonly RankedRecallHit[], limit: number): UnifiedRecallHit[] {
  return [...candidates]
    .sort((a, b) => b.fused - a.fused || tieBreakScore(b.hit) - tieBreakScore(a.hit))
    .slice(0, limit)
    .map((candidate) => candidate.hit);
}

function reciprocalRank(rank: number): number {
  return 1 / (60 + rank);
}

function recallDocText(hit: UnifiedRecallHit): string {
  return hit.source === "memory"
    ? memoryEmbedText(hit.memory)
    : episodeEmbedText(hit.episode);
}

function tieBreakScore(hit: UnifiedRecallHit): number {
  const importance = hit.source === "memory" ? hit.memory.importance : hit.episode.importance;
  const updatedAt = Date.parse(hit.source === "memory" ? hit.memory.updatedAt : hit.episode.updatedAt);
  const recency = Number.isFinite(updatedAt) ? updatedAt / 1_000_000_000_000 : 0;
  return importance + recency;
}
