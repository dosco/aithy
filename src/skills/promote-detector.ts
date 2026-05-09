import { Database } from "bun:sqlite";

export interface DetectedPattern {
  signature: string;
  toolName: string;
  argsPreview: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

const RECENT_WINDOW_MS = 7 * 86_400_000;
const MIN_OCCURRENCES = 3;

/**
 * Scan recent assistant tool-call messages for repeated patterns. Two calls
 * are considered the "same pattern" if they share tool name + a normalized
 * args signature (top-level keys + the first command/script token, ignoring
 * file paths and dynamic strings). Returns patterns that fired >=3 times in
 * the last 7 days.
 */
export function detectRepeatPatterns(db: Database): DetectedPattern[] {
  const sinceIso = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const rows = db
    .query(
      `SELECT tool_name, tool_args, created_at
       FROM messages
       WHERE role = 'assistant' AND tool_name IS NOT NULL AND created_at >= $since`,
    )
    .all({ $since: sinceIso }) as Array<{
      tool_name: string;
      tool_args: string | null;
      created_at: string;
    }>;

  const buckets = new Map<string, DetectedPattern>();
  for (const row of rows) {
    const args = parseArgs(row.tool_args);
    const sig = patternSignature(row.tool_name, args);
    const preview = previewArgs(row.tool_name, args);
    const existing = buckets.get(sig);
    if (existing) {
      existing.count += 1;
      if (row.created_at < existing.firstSeenAt) existing.firstSeenAt = row.created_at;
      if (row.created_at > existing.lastSeenAt) existing.lastSeenAt = row.created_at;
    } else {
      buckets.set(sig, {
        signature: sig,
        toolName: row.tool_name,
        argsPreview: preview,
        count: 1,
        firstSeenAt: row.created_at,
        lastSeenAt: row.created_at,
      });
    }
  }
  return [...buckets.values()]
    .filter((p) => p.count >= MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count);
}

function parseArgs(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function patternSignature(toolName: string, args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const command = typeof args.command === "string" ? args.command.split(/\s+/, 1)[0] : null;
  const path = typeof args.path === "string" ? extractExtension(args.path) : null;
  return [toolName, ...keys, command ?? "", path ?? ""].join("|");
}

function previewArgs(toolName: string, args: Record<string, unknown>): string {
  if (typeof args.command === "string") {
    const cmd = args.command.split(/\s+/, 1)[0];
    return `${toolName}: ${cmd} …`;
  }
  if (typeof args.path === "string") {
    return `${toolName}: ${args.path}`;
  }
  const keys = Object.keys(args).sort().slice(0, 3).join(", ");
  return keys ? `${toolName}: {${keys}}` : toolName;
}

function extractExtension(filepath: string): string {
  const dot = filepath.lastIndexOf(".");
  return dot >= 0 ? filepath.slice(dot) : "";
}
