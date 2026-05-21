import type { Embedder } from "../../../memory/embed";
import type { Reranker } from "../../../memory/rerank";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_RERANKER_MODEL,
  LOCAL_EMBEDDING_DIM,
} from "../../../local-inference/manifest";
import { sendRuntimeCommand } from "../../protocol/command-client";
import type { EmbeddingCommand } from "../../protocol/types";
import type { RuntimeStore } from "../../runtime-store";
import type { QueueServiceClient } from "../queue/client";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TARGET_ROLE = "local-inference-worker";

export class RemoteEmbedder implements Embedder {
  readonly modelId = DEFAULT_LOCAL_EMBEDDING_MODEL.id;
  readonly dim = LOCAL_EMBEDDING_DIM;

  constructor(private readonly store: RuntimeStore | QueueServiceClient) {}

  async init(): Promise<void> {
    if ("services" in this.store) await this.store.services();
  }

  available(): boolean {
    return serviceState(this.store) === "ready";
  }

  initFailureReason(): string | null {
    const service = "serviceSync" in this.store
      ? this.store.serviceSync(TARGET_ROLE)
      : this.store.service(TARGET_ROLE);
    if (service?.state !== "failed" && service?.state !== "degraded") return null;
    return service.detail ? JSON.stringify(service.detail) : service.state;
  }

  async embed(text: string): Promise<Float32Array> {
    const [vector] = await this.embedMany([text]);
    if (!vector) throw new Error("local-inference-worker returned no vector");
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

  async embedQuery(text: string): Promise<Float32Array> {
    const result = await this.send({
      kind: "embedding.embedQuery",
      payload: { text },
      result: { vector: [] },
    });
    return new Float32Array(result.vector);
  }

  private send<T extends EmbeddingCommand>(command: T): Promise<T["result"]> {
    return sendRuntimeCommand(this.store, TARGET_ROLE, command, { timeoutMs: DEFAULT_TIMEOUT_MS });
  }
}

export class RemoteReranker implements Reranker {
  readonly modelId = DEFAULT_LOCAL_RERANKER_MODEL.id;

  constructor(private readonly store: RuntimeStore | QueueServiceClient) {}

  async init(): Promise<void> {
    if ("services" in this.store) await this.store.services();
  }

  available(): boolean {
    return serviceState(this.store) === "ready";
  }

  initFailureReason(): string | null {
    const service = "serviceSync" in this.store
      ? this.store.serviceSync(TARGET_ROLE)
      : this.store.service(TARGET_ROLE);
    if (service?.state !== "failed" && service?.state !== "degraded") return null;
    return service.detail ? JSON.stringify(service.detail) : service.state;
  }

  async rerank(query: string, docs: readonly string[]): Promise<number[]> {
    if (docs.length === 0) return [];
    const result = await sendRuntimeCommand(
      this.store,
      TARGET_ROLE,
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
    ? store.serviceSync(TARGET_ROLE)
    : store.service(TARGET_ROLE);
  return service?.state;
}
