import type { Embedder } from "../memory/embed";
import type { Reranker } from "../memory/rerank";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_RERANKER_MODEL,
  LOCAL_EMBEDDING_DIM,
  LOCAL_EMBEDDING_MODEL_ALIAS,
  LOCAL_RERANKER_MODEL_ALIAS,
} from "./manifest";

const EMBEDDING_INSTRUCTION =
  "Instruct: Retrieve relevant Aithy memories and episodes for the user query.\nQuery: ";

export class LocalLlamaEmbedder implements Embedder {
  readonly modelId = DEFAULT_LOCAL_EMBEDDING_MODEL.id;
  readonly dim = LOCAL_EMBEDDING_DIM;

  constructor(
    private readonly baseUrl: () => string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async init(): Promise<void> {}

  available(): boolean {
    return Boolean(this.baseUrl());
  }

  initFailureReason(): string | null {
    return this.available() ? null : "local inference router is not ready";
  }

  embed(text: string): Promise<Float32Array> {
    return this.embedOne(formatDocumentText(text));
  }

  async embedMany(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.requestEmbeddings(texts.map(formatDocumentText));
  }

  embedQuery(text: string): Promise<Float32Array> {
    return this.embedOne(`${EMBEDDING_INSTRUCTION}${text.trim()}`);
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const [vector] = await this.requestEmbeddings([text]);
    if (!vector) throw new Error("local embedding returned no vector");
    return vector;
  }

  private async requestEmbeddings(texts: readonly string[]): Promise<Float32Array[]> {
    const baseUrl = this.requireBaseUrl();
    const json = await postJson<EmbeddingResponse>(
      `${baseUrl}/v1/embeddings`,
      {
        model: LOCAL_EMBEDDING_MODEL_ALIAS,
        input: texts,
        encoding_format: "float",
      },
      this.fetchImpl,
    );
    if (!Array.isArray(json.data)) throw new Error("local embedding response missing data");
    return json.data.map((item) => {
      if (!Array.isArray(item.embedding)) throw new Error("local embedding item missing embedding");
      if (item.embedding.length !== this.dim) {
        throw new Error(`local embedding dimension ${item.embedding.length} did not match ${this.dim}`);
      }
      return new Float32Array(item.embedding);
    });
  }

  private requireBaseUrl(): string {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error("local inference router is not ready");
    return baseUrl;
  }
}

export class LocalLlamaReranker implements Reranker {
  readonly modelId = DEFAULT_LOCAL_RERANKER_MODEL.id;

  constructor(
    private readonly baseUrl: () => string | null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async init(): Promise<void> {}

  available(): boolean {
    return Boolean(this.baseUrl());
  }

  initFailureReason(): string | null {
    return this.available() ? null : "local inference router is not ready";
  }

  async rerank(query: string, docs: readonly string[]): Promise<number[]> {
    if (docs.length === 0) return [];
    const json = await postJson<RerankResponse>(
      `${this.requireBaseUrl()}/v1/rerank`,
      {
        model: LOCAL_RERANKER_MODEL_ALIAS,
        query,
        documents: [...docs],
        top_n: docs.length,
      },
      this.fetchImpl,
    );
    const results = Array.isArray(json.results) ? json.results : json.data;
    if (!Array.isArray(results)) throw new Error("local rerank response missing results");
    const scores = new Array<number>(docs.length).fill(0);
    for (const item of results) {
      if (typeof item.index !== "number") continue;
      scores[item.index] = Number(item.relevance_score ?? item.score ?? 0);
    }
    return scores;
  }

  private requireBaseUrl(): string {
    const baseUrl = this.baseUrl();
    if (!baseUrl) throw new Error("local inference router is not ready");
    return baseUrl;
  }
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

interface RerankResponse {
  results?: RerankResult[];
  data?: RerankResult[];
}

interface RerankResult {
  index?: number;
  relevance_score?: number;
  score?: number;
}

async function postJson<T>(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url} failed: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function formatDocumentText(text: string): string {
  return text.trim();
}
