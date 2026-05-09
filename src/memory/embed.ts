import path from "node:path";

export interface EmbedServiceOptions {
  cacheDir: string;
  modelId?: string;
  log?: (msg: string) => void;
}

const DEFAULT_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBED_DIM = 384;

export interface Embedder {
  readonly modelId: string;
  readonly dim: number;
  init(): Promise<void>;
  available(): boolean;
  initFailureReason(): string | null;
  embed(text: string): Promise<Float32Array>;
  embedMany(texts: readonly string[]): Promise<Float32Array[]>;
}

/**
 * In-process embedding service backed by @xenova/transformers running on
 * onnxruntime-node. Singleton-per-instance: the underlying pipeline is
 * cached lazily on first init().
 *
 * On first run the model (~25 MB quantized ONNX) is downloaded from the
 * HuggingFace Hub into `cacheDir`. Subsequent runs hit the local cache.
 *
 * If init() fails (network error, missing onnxruntime binary, etc.) the
 * service remains in `available() === false` and embed() rejects fast so
 * callers can degrade gracefully.
 */
export class EmbedService implements Embedder {
  readonly modelId: string;
  readonly dim = EMBED_DIM;
  private readonly cacheDir: string;
  private readonly log?: (msg: string) => void;
  private pipelinePromise: Promise<unknown> | null = null;
  private extractor: ((text: string | string[], opts: { pooling: "mean"; normalize: true }) =>
    Promise<{ data: Float32Array; dims: number[] }>) | null = null;
  private initFailed: string | null = null;

  constructor(opts: EmbedServiceOptions) {
    this.modelId = opts.modelId ?? DEFAULT_MODEL_ID;
    this.cacheDir = path.join(opts.cacheDir, "transformers");
    this.log = opts.log;
  }

  async init(): Promise<void> {
    if (this.extractor || this.initFailed) return;
    if (!this.pipelinePromise) {
      this.pipelinePromise = this.loadPipeline();
    }
    try {
      await this.pipelinePromise;
    } catch (err) {
      this.initFailed = (err as Error).message;
      this.log?.(`memory: embedder init failed — ${this.initFailed}`);
    }
  }

  available(): boolean {
    return this.extractor !== null;
  }

  initFailureReason(): string | null {
    return this.initFailed;
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error(
        `embedder not available: ${this.initFailed ?? "init() not awaited"}`,
      );
    }
    const out = await this.extractor(text, { pooling: "mean", normalize: true });
    return new Float32Array(out.data);
  }

  async embedMany(texts: readonly string[]): Promise<Float32Array[]> {
    if (!this.extractor) {
      throw new Error(
        `embedder not available: ${this.initFailed ?? "init() not awaited"}`,
      );
    }
    if (texts.length === 0) return [];
    const out = await this.extractor([...texts], { pooling: "mean", normalize: true });
    const dim = out.dims.at(-1) ?? this.dim;
    const result: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      const start = i * dim;
      result.push(new Float32Array(out.data.slice(start, start + dim)));
    }
    return result;
  }

  private async loadPipeline(): Promise<void> {
    const transformers = await import("@xenova/transformers");
    transformers.env.cacheDir = this.cacheDir;
    transformers.env.allowLocalModels = true;
    const extractor = await transformers.pipeline(
      "feature-extraction",
      this.modelId,
      { quantized: true },
    );
    this.extractor = extractor as unknown as typeof this.extractor;
    this.log?.(`memory: embedder ready (model=${this.modelId} dim=${this.dim})`);
  }
}
