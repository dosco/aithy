import type { Embedder } from "../../../memory/embed";
import type { Reranker } from "../../../memory/rerank";
import { sendRuntimeCommand } from "../../protocol/command-client";
import type { EmbeddingCommand } from "../../protocol/types";
import type { RuntimeStore } from "../../runtime-store";
import type { QueueServiceClient } from "../queue/client";

const DEFAULT_EMBED_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_RERANK_MODEL_ID = "Xenova/ms-marco-MiniLM-L-6-v2";
const EMBED_DIM = 384;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export class RemoteEmbedder implements Embedder {
  readonly modelId = DEFAULT_EMBED_MODEL_ID;
  readonly dim = EMBED_DIM;

  constructor(private readonly store: RuntimeStore | QueueServiceClient) {}

  async init(): Promise<void> {
    if ("services" in this.store) await this.store.services();
  }

  available(): boolean {
    return serviceState(this.store) === "ready";
  }

  initFailureReason(): string | null {
    const service = "serviceSync" in this.store
      ? this.store.serviceSync("embedding-worker")
      : this.store.service("embedding-worker");
    if (service?.state !== "failed" && service?.state !== "degraded") return null;
    return service.detail ? JSON.stringify(service.detail) : service.state;
  }

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedMany([text]);
    if (!vector) throw new Error("embedding-worker returned no vector");
    return vector;
  }

  async embedMany(texts: readonly string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const result = await this.send({
      kind: "embedding.embedMany",
      payload: { texts: [...texts] },
      result: { vectors: [] },
    });
    return result.vectors.map((vector) => new Float32Array(vector));
  }

  private send<T extends EmbeddingCommand>(command: T): Promise<T["result"]> {
    return sendRuntimeCommand(this.store, "embedding-worker", command, { timeoutMs: DEFAULT_TIMEOUT_MS });
  }
}

export class RemoteReranker implements Reranker {
  readonly modelId = DEFAULT_RERANK_MODEL_ID;

  constructor(private readonly store: RuntimeStore | QueueServiceClient) {}

  async init(): Promise<void> {
    if ("services" in this.store) await this.store.services();
  }

  available(): boolean {
    return serviceState(this.store) === "ready";
  }

  initFailureReason(): string | null {
    const service = "serviceSync" in this.store
      ? this.store.serviceSync("embedding-worker")
      : this.store.service("embedding-worker");
    if (service?.state !== "failed" && service?.state !== "degraded") return null;
    return service.detail ? JSON.stringify(service.detail) : service.state;
  }

  async rerank(query: string, docs: readonly string[]): Promise<number[]> {
    if (docs.length === 0) return [];
    const result = await sendRuntimeCommand(
      this.store,
      "embedding-worker",
      {
        kind: "embedding.rerank",
        payload: { query, docs: [...docs] },
        result: { scores: [] },
      },
      { timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    return result.scores;
  }
}

function serviceState(store: RuntimeStore | QueueServiceClient): string | undefined {
  const service = "serviceSync" in store
    ? store.serviceSync("embedding-worker")
    : store.service("embedding-worker");
  return service?.state;
}
