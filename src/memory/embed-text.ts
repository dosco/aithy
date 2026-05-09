import { createHash } from "node:crypto";

export interface EmbedTextInput {
  title: string;
  body: string;
  tags: string | null;
}

/**
 * Canonical text passed to the embedder. Used at write time AND during
 * backfill so they stay in lockstep — if this changes, every memory needs
 * to re-embed (bump the model_id sentinel to force it).
 */
export function embedText(entry: EmbedTextInput): string {
  const parts = [entry.title.trim(), entry.body.trim()];
  const tags = entry.tags?.trim();
  if (tags) parts.push(tags);
  return parts.join("\n");
}

export function bodyHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Pack a 384d Float32 embedding for sqlite-vec. bun:sqlite does not accept
 * raw ArrayBuffer — it must be a Uint8Array or Buffer. We standardize on
 * Uint8Array.
 */
export function vecToBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}
