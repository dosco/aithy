import type { SqliteEpisodeStore } from "../episodes/episode-store";
import { episodeEmbedText } from "../episodes/embed-text";
import type { AgentEpisodeEntry } from "../episodes/types";
import { embedText as memoryEmbedText } from "../memory/embed-text";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { Reranker } from "../memory/rerank";
import type { MemoryEntry } from "../memory/types";
import type { TranscriptRecallEntry, SqliteTranscriptRecallStore } from "./transcript-recall";
import {
  combineRetrievalMode,
  retrievalDiagnostics,
  sourceStats,
  type RetrievalDiagnostics,
} from "./diagnostics";
import { containsAnchor, buildRetrievalQueryPlan, type RetrievalLane } from "./query-plan";

type UnrankedRecallHit =
  | { source: "memory"; id: string; memory: MemoryEntry }
  | { source: "episode"; id: string; episode: AgentEpisodeEntry }
  | { source: "transcript"; id: string; transcript: TranscriptRecallEntry };

export type UnifiedRecallHit = UnrankedRecallHit & { rank: RecallRankMetadata };

export interface RecallRankMetadata {
  fusedScore: number;
  matchedLane: RetrievalLane;
  exactAnchor: boolean;
  rerankScore?: number;
  contentBytes?: number;
}

interface RankedRecallHit {
  hit: UnrankedRecallHit;
  fused: number;
  rank: RecallRankMetadata;
}

export interface UnifiedRecallResult {
  hits: UnifiedRecallHit[];
  diagnostics: RetrievalDiagnostics;
}

export interface UnifiedRecallOptions {
  memory?: SqliteMemoryStore;
  episodes?: SqliteEpisodeStore;
  transcripts?: SqliteTranscriptRecallStore;
  queries: readonly string[];
  excludeMemoryIds?: readonly string[];
  excludeEpisodeIds?: readonly string[];
  excludeTranscriptIds?: readonly string[];
  beforeCreatedAt?: string;
  limit?: number;
  markRecalled?: boolean;
  source?: "preload" | "recall";
}

const DEFAULT_LIMIT = 8;
const PER_SOURCE_CANDIDATES = 30;
const FUSED_CANDIDATE_LIMIT = 60;
const RERANK_CANDIDATE_LIMIT = 30;

export async function unifiedMemoryRecall(opts: UnifiedRecallOptions): Promise<UnifiedRecallResult> {
  const startedAt = performance.now();
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const candidateLimit = Math.max(limit, PER_SOURCE_CANDIDATES);
  const queryPlan = buildRetrievalQueryPlan(opts.queries);
  const queries = queryPlan.rawQueries;
  if (queries.length === 0 || (!opts.memory && !opts.episodes && !opts.transcripts)) {
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

  const [memoryResult, episodeResult, transcriptResult] = await Promise.all([
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
    opts.transcripts ? searchTranscripts(opts.transcripts, queries, {
      limit: candidateLimit,
      excludeIds: opts.excludeTranscriptIds,
      beforeCreatedAt: opts.beforeCreatedAt,
    }) : undefined,
  ]);

  const candidates: RankedRecallHit[] = [
    ...(memoryResult?.entries ?? []).map((memory, rank): RankedRecallHit => ({
      hit: { source: "memory", id: memory.id, memory },
      fused: reciprocalRank(rank),
      rank: rankMetadata(memoryEmbedText(memory), reciprocalRank(rank), queryPlan.anchorTerms),
    })),
    ...(episodeResult?.entries ?? []).map((episode, rank): RankedRecallHit => ({
      hit: { source: "episode", id: episode.id, episode },
      fused: reciprocalRank(rank),
      rank: rankMetadata(episodeEmbedText(episode), reciprocalRank(rank), queryPlan.anchorTerms),
    })),
    ...(transcriptResult?.entries ?? []).map((transcript, rank): RankedRecallHit => ({
      hit: { source: "transcript", id: transcript.id, transcript },
      fused: reciprocalRank(rank),
      rank: rankMetadata(transcript.content, reciprocalRank(rank), queryPlan.anchorTerms),
    })),
  ];
  const diagnostics = [memoryResult?.diagnostics, episodeResult?.diagnostics, transcriptResult?.diagnostics]
    .filter((item): item is RetrievalDiagnostics => Boolean(item));
  const reranker = opts.memory?.availableReranker?.() ?? opts.episodes?.availableReranker?.() ?? null;
  const ranked = await finalRank(candidates, queries, reranker);
  const budgeted = budgetHits(ranked.hits, {
    source: opts.source ?? "recall",
    limit,
    hasAnchors: queryPlan.hasAnchors,
  });

  if (opts.markRecalled !== false && budgeted.hits.length > 0) {
    const hits = budgeted.hits;
    opts.memory?.markRecalledIds?.(hits.flatMap((hit) => hit.source === "memory" ? [hit.id] : []));
    opts.episodes?.markRecalledIds?.(hits.flatMap((hit) => hit.source === "episode" ? [hit.id] : []));
  }

  return {
    hits: budgeted.hits,
    diagnostics: retrievalDiagnostics({
      source: opts.source ?? "recall",
      mode: combineRetrievalMode(diagnostics, ranked.reranked),
      queryCount: queries.length,
      rerankerAvailable: Boolean(reranker),
      startedAt,
      sources: diagnostics.flatMap((item) => item.sources),
      errors: ranked.errors,
      candidateMatches: ranked.hits.length,
      injectedMatches: budgeted.hits.length,
      withheldMatches: budgeted.withheld,
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

function searchTranscripts(
  store: SqliteTranscriptRecallStore,
  queries: readonly string[],
  opts: { limit: number; excludeIds?: readonly string[]; beforeCreatedAt?: string },
): { entries: TranscriptRecallEntry[]; diagnostics: RetrievalDiagnostics } {
  return store.searchDetailed(queries, opts);
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
): Promise<{ hits: UnifiedRecallHit[]; reranked: boolean; errors: string[] }> {
  if (candidates.length === 0) return { hits: [], reranked: false, errors: [] };
  const fallback = fusedFallback(candidates);
  if (!reranker?.available()) return { hits: fallback, reranked: false, errors: [] };
  try {
    const top = fallback.slice(0, RERANK_CANDIDATE_LIMIT);
    const rest = fallback.slice(RERANK_CANDIDATE_LIMIT);
    const docs = top.map(recallDocText);
    const scores = await reranker.rerank(queries.join("\n"), docs);
    if (scores.length !== top.length) throw new Error("reranker returned mismatched score count");
    return {
      hits: [
        ...top
          .map((hit, index) => withRank(hit, { ...hit.rank, rerankScore: scores[index] }))
          .sort((a, b) => (b.rank.rerankScore ?? 0) - (a.rank.rerankScore ?? 0) || tieBreakScore(b) - tieBreakScore(a)),
        ...rest,
      ],
      reranked: true,
      errors: [],
    };
  } catch (error) {
    return {
      hits: fallback,
      reranked: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function fusedFallback(candidates: readonly RankedRecallHit[]): UnifiedRecallHit[] {
  return [...candidates]
    .sort((a, b) => b.fused - a.fused || tieBreakScore(b.hit) - tieBreakScore(a.hit))
    .slice(0, FUSED_CANDIDATE_LIMIT)
    .map((candidate) => withRank(candidate.hit, candidate.rank));
}

function reciprocalRank(rank: number): number {
  return 1 / (60 + rank);
}

function recallDocText(hit: UnrankedRecallHit | UnifiedRecallHit): string {
  if (hit.source === "memory") return memoryEmbedText(hit.memory);
  if (hit.source === "episode") return episodeEmbedText(hit.episode);
  return hit.transcript.content;
}

function tieBreakScore(hit: UnrankedRecallHit | UnifiedRecallHit): number {
  const importance = hit.source === "memory" ? hit.memory.importance : hit.source === "episode" ? hit.episode.importance : 0.2;
  const updatedAt = Date.parse(hit.source === "memory" ? hit.memory.updatedAt : hit.source === "episode" ? hit.episode.updatedAt : hit.transcript.createdAt);
  const recency = Number.isFinite(updatedAt) ? updatedAt / 1_000_000_000_000 : 0;
  return importance + recency;
}

function rankMetadata(text: string, fusedScore: number, anchors: readonly string[]): RecallRankMetadata {
  const exactAnchor = containsAnchor(text, anchors);
  return {
    fusedScore,
    matchedLane: exactAnchor ? "anchor" : "semantic",
    exactAnchor,
    contentBytes: Buffer.byteLength(text, "utf8"),
  };
}

function withRank(hit: UnrankedRecallHit, rank: RecallRankMetadata): UnifiedRecallHit {
  return { ...hit, rank } as UnifiedRecallHit;
}

function budgetHits(
  hits: readonly UnifiedRecallHit[],
  opts: { source: "preload" | "recall"; limit: number; hasAnchors: boolean },
): { hits: UnifiedRecallHit[]; withheld: number } {
  const sourceLimits = opts.source === "preload"
    ? { memory: 2, episode: 1, transcript: hits.some((hit) => hit.source === "transcript" && hit.rank.exactAnchor) ? 2 : 1 }
    : { memory: 4, episode: 2, transcript: 2 };
  const counts = { memory: 0, episode: 0, transcript: 0 };
  const seen = new Set<string>();
  const selected: UnifiedRecallHit[] = [];
  let withheld = 0;
  for (const hit of hits) {
    if (selected.length >= opts.limit) {
      withheld += 1;
      continue;
    }
    if (!passesConfidence(hit, opts.hasAnchors)) {
      withheld += 1;
      continue;
    }
    if (counts[hit.source] >= sourceLimits[hit.source]) {
      withheld += 1;
      continue;
    }
    const key = dedupeKey(hit);
    if (seen.has(key)) {
      withheld += 1;
      continue;
    }
    seen.add(key);
    counts[hit.source] += 1;
    selected.push(hit);
  }
  return { hits: selected, withheld };
}

function passesConfidence(hit: UnifiedRecallHit, hasAnchors: boolean): boolean {
  if (hit.rank.exactAnchor) return true;
  if (hasAnchors) return false;
  if (hit.rank.matchedLane === "tokens" && hit.rank.fusedScore < 0.025) return false;
  return hit.rank.fusedScore >= 0.015;
}

function dedupeKey(hit: UnifiedRecallHit): string {
  return recallDocText(hit).toLowerCase().replace(/\W+/g, " ").trim().slice(0, 180);
}
