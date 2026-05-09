import type { Reranker } from "../src/memory/rerank";

export interface MockRerankerOptions {
  /**
   * Substrings that, when present in the doc, indicate the doc is "relevant"
   * to ANY query containing one of the matched substrings. The mock returns
   * a high logit for matches and a low logit for misses, simulating the
   * cross-encoder's fine-grained relevance signal.
   */
  relevantSubstrings?: ReadonlyArray<readonly [queryToken: string, docToken: string]>;
}

/**
 * Deterministic mock cross-encoder. Used in tests to exercise the rerank
 * path without downloading a real model. The default behavior is "anything
 * that shares a token with the query is relevant", with a tunable boost
 * table for synonym pairs.
 */
export class MockReranker implements Reranker {
  readonly modelId = "mock-reranker-v1";
  private ready = true;
  private failureReason: string | null = null;
  private readonly relevantSubstrings: ReadonlyArray<readonly [string, string]>;

  constructor(opts: MockRerankerOptions = {}) {
    this.relevantSubstrings = opts.relevantSubstrings ?? [];
  }

  async init(): Promise<void> {
    return;
  }

  setUnavailable(reason: string): void {
    this.ready = false;
    this.failureReason = reason;
  }

  available(): boolean {
    return this.ready;
  }

  initFailureReason(): string | null {
    return this.failureReason;
  }

  async rerank(query: string, docs: readonly string[]): Promise<number[]> {
    const q = query.toLowerCase();
    return docs.map((doc) => {
      const d = doc.toLowerCase();
      // Synonym table: query token A → doc token B is treated as a strong match.
      for (const [qTok, dTok] of this.relevantSubstrings) {
        if (q.includes(qTok.toLowerCase()) && d.includes(dTok.toLowerCase())) {
          return 8;
        }
      }
      // Fallback: shared word = mild positive, otherwise negative.
      const queryWords = q.split(/\s+/).filter((w) => w.length > 2);
      const overlap = queryWords.filter((w) => d.includes(w)).length;
      if (overlap === 0) return -10;
      return -2 + overlap * 2;
    });
  }
}
