import path from "node:path";

export interface RerankerOptions {
  cacheDir: string;
  modelId?: string;
  log?: (msg: string) => void;
}

export interface Reranker {
  readonly modelId: string;
  init(): Promise<void>;
  available(): boolean;
  initFailureReason(): string | null;
  /**
   * Score `(query, doc)` pairs in a batch. Returns one logit per doc; higher
   * means more relevant. The cross-encoder runs full attention between query
   * and doc tokens, which is meaningfully better at top-K precision than the
   * pooled bi-encoder embeddings used for candidate retrieval.
   */
  rerank(query: string, docs: readonly string[]): Promise<number[]>;
}

const DEFAULT_MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";

interface TokenizerLike {
  (
    queries: string | string[],
    opts: { text_pair?: string | string[]; padding: boolean; truncation: boolean },
  ): unknown;
}

interface ModelLike {
  (inputs: unknown): Promise<{ logits: { data: Float32Array | number[] } }>;
}

/**
 * In-process cross-encoder reranker. Loads `Xenova/ms-marco-MiniLM-L-6-v2`
 * (~80 MB quantized) via @xenova/transformers and runs token-level scoring
 * on (query, doc) pairs. Used after the RRF fusion to refine the top-K
 * ordering.
 *
 * Singleton-per-instance: the underlying tokenizer + model are cached lazily
 * on first init(). If init fails (network, missing onnxruntime-node binary,
 * etc.) the service stays unavailable and rerank() rejects fast — callers
 * fall back to RRF ordering.
 */
export class RerankerService implements Reranker {
  readonly modelId: string;
  private readonly cacheDir: string;
  private readonly log?: (msg: string) => void;
  private loadPromise: Promise<void> | null = null;
  private tokenizer: TokenizerLike | null = null;
  private model: ModelLike | null = null;
  private initFailed: string | null = null;

  constructor(opts: RerankerOptions) {
    this.modelId = opts.modelId ?? DEFAULT_MODEL_ID;
    this.cacheDir = path.join(opts.cacheDir, "transformers");
    this.log = opts.log;
  }

  async init(): Promise<void> {
    if (this.tokenizer || this.initFailed) return;
    if (!this.loadPromise) this.loadPromise = this.loadModel();
    try {
      await this.loadPromise;
    } catch (err) {
      this.initFailed = (err as Error).message;
      this.log?.(`memory: reranker init failed — ${this.initFailed}`);
    }
  }

  available(): boolean {
    return this.tokenizer !== null && this.model !== null;
  }

  initFailureReason(): string | null {
    return this.initFailed;
  }

  async rerank(query: string, docs: readonly string[]): Promise<number[]> {
    if (!this.tokenizer || !this.model) {
      throw new Error(
        `reranker not available: ${this.initFailed ?? "init() not awaited"}`,
      );
    }
    if (docs.length === 0) return [];
    const queries = docs.map(() => query);
    const inputs = this.tokenizer(queries, {
      text_pair: [...docs],
      padding: true,
      truncation: true,
    });
    const out = await this.model(inputs);
    return Array.from(out.logits.data as Float32Array | number[]);
  }

  private async loadModel(): Promise<void> {
    const transformers = await import("@xenova/transformers");
    transformers.env.cacheDir = this.cacheDir;
    transformers.env.allowLocalModels = true;
    const tokenizer = (await transformers.AutoTokenizer.from_pretrained(this.modelId, {
      quantized: true,
    })) as unknown as TokenizerLike;
    const model = (await transformers.AutoModelForSequenceClassification.from_pretrained(
      this.modelId,
      { quantized: true },
    )) as unknown as ModelLike;
    this.tokenizer = tokenizer;
    this.model = model;
    this.log?.(`memory: reranker ready (model=${this.modelId})`);
  }
}
