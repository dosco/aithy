export interface Reranker {
  readonly modelId: string;
  init(): Promise<void>;
  available(): boolean;
  initFailureReason(): string | null;
  rerank(query: string, docs: readonly string[]): Promise<number[]>;
}
