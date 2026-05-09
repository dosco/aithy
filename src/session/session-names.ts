const DEFAULT_SESSION_NAME = "New session";
const MAX_SESSION_NAME_CHARS = 48;

export function defaultSessionName(): string {
  return DEFAULT_SESSION_NAME;
}

export function generateSessionName(text: string): string {
  const normalized = text
    .replace(/^\/\S+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return DEFAULT_SESSION_NAME;

  const words = normalized
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  const title = words.join(" ").trim();
  if (!title) return DEFAULT_SESSION_NAME;
  if (title.length <= MAX_SESSION_NAME_CHARS) return title;
  return `${title.slice(0, MAX_SESSION_NAME_CHARS - 1).trimEnd()}...`;
}

export function sessionIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return slug || "session";
}

export function isSafeSessionId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}
