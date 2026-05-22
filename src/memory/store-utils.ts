const MAX_BODY_BYTES = 4096;

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function capBody(body: string): string {
  const buf = Buffer.from(body, "utf8");
  if (buf.byteLength <= MAX_BODY_BYTES) return body;
  return `${buf.subarray(0, MAX_BODY_BYTES).toString("utf8")}\n[truncated]`;
}

export function quoteForFts5(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `"${cleaned}"` : "";
}
