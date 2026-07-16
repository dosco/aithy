export type RetrievalMode = "fts-only" | "hybrid" | "hybrid-reranked" | "fallback";

export interface RetrievalSourceStats {
  source: "memories" | "episodes" | "skills" | "transcripts" | "knowledge";
  ftsCandidates: number;
  vectorCandidates: number;
  fusedCandidates: number;
  finalMatches: number;
}

export interface RetrievalDiagnostics {
  source: "preload" | "recall" | "skills" | "knowledge" | "store";
  mode: RetrievalMode;
  queryCount: number;
  rerankerAvailable: boolean;
  latencyMs: number;
  sources: RetrievalSourceStats[];
  errors: string[];
  candidateMatches?: number;
  injectedMatches?: number;
  withheldMatches?: number;
}

export interface RetrievalStatsInput {
  source: RetrievalSourceStats["source"];
  ftsCandidates?: number;
  vectorCandidates?: number;
  fusedCandidates?: number;
  finalMatches?: number;
}

export function sourceStats(input: RetrievalStatsInput): RetrievalSourceStats {
  return {
    source: input.source,
    ftsCandidates: input.ftsCandidates ?? 0,
    vectorCandidates: input.vectorCandidates ?? 0,
    fusedCandidates: input.fusedCandidates ?? 0,
    finalMatches: input.finalMatches ?? 0,
  };
}

export function retrievalDiagnostics(input: {
  source: RetrievalDiagnostics["source"];
  mode: RetrievalMode;
  queryCount: number;
  rerankerAvailable?: boolean;
  startedAt: number;
  sources: RetrievalSourceStats[];
  errors?: string[];
  candidateMatches?: number;
  injectedMatches?: number;
  withheldMatches?: number;
}): RetrievalDiagnostics {
  return {
    source: input.source,
    mode: input.mode,
    queryCount: input.queryCount,
    rerankerAvailable: input.rerankerAvailable ?? false,
    latencyMs: Math.max(0, Math.round(performance.now() - input.startedAt)),
    sources: input.sources,
    errors: input.errors ?? [],
    ...(input.candidateMatches !== undefined ? { candidateMatches: input.candidateMatches } : {}),
    ...(input.injectedMatches !== undefined ? { injectedMatches: input.injectedMatches } : {}),
    ...(input.withheldMatches !== undefined ? { withheldMatches: input.withheldMatches } : {}),
  };
}

export function combineRetrievalMode(
  diagnostics: readonly RetrievalDiagnostics[],
  reranked: boolean,
): RetrievalMode {
  if (reranked) return "hybrid-reranked";
  if (diagnostics.some((item) => item.mode === "hybrid" || item.mode === "hybrid-reranked")) return "hybrid";
  if (diagnostics.some((item) => item.mode === "fallback")) return "fallback";
  return "fts-only";
}
