import type { Embedder } from "../src/memory/embed";

/**
 * Deterministic mock embedder for tests. Maps each unique input string to a
 * stable 384d vector based on a simple hash. Tests can construct a memory
 * store with this embedder and exercise the hybrid retrieval path without
 * downloading a real model.
 *
 * To make synonym tests work, we also accept a `synonyms` map: pairs of
 * strings that should embed to nearly-identical vectors so the cosine
 * distance between them is ~0 even though FTS5 wouldn't find a token match.
 */
export class MockEmbedder implements Embedder {
  readonly modelId = "mock-embedder-v1";
  readonly dim = 384;
  private ready = true;
  private failureReason: string | null = null;
  private readonly synonymVectors = new Map<string, Float32Array>();

  constructor(synonymGroups: ReadonlyArray<readonly string[]> = []) {
    for (const group of synonymGroups) {
      const baseVec = makeVector(group[0] ?? "", this.dim);
      for (const text of group) {
        this.synonymVectors.set(text, baseVec);
      }
    }
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

  async embed(text: string): Promise<Float32Array> {
    return this.embedSync(text);
  }

  async embedMany(texts: readonly string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.embedSync(t));
  }

  private embedSync(text: string): Float32Array {
    for (const [synonym, vec] of this.synonymVectors) {
      if (text.toLowerCase().includes(synonym.toLowerCase())) {
        return vec;
      }
    }
    return makeVector(text, this.dim);
  }
}

function makeVector(text: string, dim: number): Float32Array {
  const out = new Float32Array(dim);
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < dim; i++) {
    h = (h * 1103515245 + 12345) | 0;
    out[i] = ((h & 0x7fff) / 0x7fff) * 2 - 1;
  }
  return normalize(out);
}

function normalize(v: Float32Array): Float32Array {
  let mag = 0;
  for (const x of v) mag += x * x;
  mag = Math.sqrt(mag);
  if (mag === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = v[i] / mag;
  return v;
}
