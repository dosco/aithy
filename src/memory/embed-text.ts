import { createHash } from "node:crypto";

export interface EmbedTextInput {
  subject?: string | null;
  scopeKind?: string | null;
  scopeRef?: string | null;
  guidance?: string | null;
  title: string;
  body: string;
  validFrom?: string | null;
  validUntil?: string | null;
  durationDays?: number | null;
  evidence?: string | null;
  frequency?: string | null;
}

/**
 * Canonical text passed to the embedder. Used at write time AND during
 * backfill so they stay in lockstep — if this changes, every memory needs
 * to re-embed (bump the model_id sentinel to force it).
 */
export function embedText(entry: EmbedTextInput): string {
  const parts = [
    entry.title.trim(),
    entry.subject ? `subject: ${entry.subject}` : null,
    entry.scopeKind ? `scope: ${entry.scopeKind}${entry.scopeRef ? ` ${entry.scopeRef}` : ""}` : null,
    entry.guidance ? `guidance: ${entry.guidance}` : null,
    entry.body.trim(),
  ].filter((part): part is string => Boolean(part));
  if (entry.frequency) parts.push(`frequency: ${entry.frequency}`);
  if (entry.validFrom || entry.validUntil) {
    parts.push(`valid: ${entry.validFrom ?? "unknown"} to ${entry.validUntil ?? "unknown"}`);
  }
  if (entry.durationDays !== null && entry.durationDays !== undefined) parts.push(`duration_days: ${entry.durationDays}`);
  if (entry.evidence) parts.push(`evidence: ${entry.evidence}`);
  return parts.join("\n");
}

export function bodyHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Pack a Float32 embedding for sqlite-vec. bun:sqlite does not accept
 * raw ArrayBuffer — it must be a Uint8Array or Buffer. We standardize on
 * Uint8Array.
 */
export function vecToBlob(vec: Float32Array): Uint8Array {
  return new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
}
