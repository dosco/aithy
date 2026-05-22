export type TargetIndexStatus = "indexed" | "skipped" | "missing" | "failed";

export interface TargetIndexCounts {
  indexed: number;
  skipped: number;
  missing: number;
  failed: number;
}

export interface EmbeddingHealthStats {
  total: number;
  embedded: number;
  stale: number;
}

export function emptyIndexCounts(): TargetIndexCounts {
  return { indexed: 0, skipped: 0, missing: 0, failed: 0 };
}

export function failedIndexCounts(count: number): TargetIndexCounts {
  return { indexed: 0, skipped: 0, missing: 0, failed: count };
}
