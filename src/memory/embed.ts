export interface Embedder {
  readonly modelId: string;
  readonly dim: number;
  init(): Promise<void>;
  available(): boolean;
  initFailureReason(): string | null;
  embed(text: string): Promise<Float32Array>;
  embedMany(texts: readonly string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}
