export function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function clampText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 20).trimEnd()}\n[content truncated]`;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
