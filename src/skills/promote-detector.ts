import { Database } from "bun:sqlite";

export interface DetectedPattern {
  signature: string;
  toolName: string;
  argsPreview: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceSessionId: string;
  sourceMessageId: number;
  examples: DetectedPatternExample[];
}

export interface DetectedPatternExample {
  sessionId: string;
  messageId: number;
  toolArgs: unknown;
  toolResult: unknown;
  createdAt: string;
}

const RECENT_WINDOW_MS = 7 * 86_400_000;
const MIN_OCCURRENCES = 3;
const MAX_EXAMPLES = 5;

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
      `SELECT id, session_id, tool_name, tool_args, tool_result, created_at
       FROM messages
       WHERE role = 'assistant' AND tool_name IS NOT NULL AND created_at >= $since`,
    )
    .all({ $since: sinceIso }) as Array<{
      id: number;
      session_id: string;
      tool_name: string;
      tool_args: string | null;
      tool_result: string | null;
      created_at: string;
    }>;

  const buckets = new Map<string, DetectedPattern>();
  for (const row of rows) {
    const args = parseArgs(row.tool_args);
    const result = parseJson(row.tool_result);
    const sig = patternSignature(row.tool_name, args);
    const preview = previewArgs(row.tool_name, args);
    const example = {
      sessionId: row.session_id,
      messageId: row.id,
      toolArgs: args,
      toolResult: result,
      createdAt: row.created_at,
    };
    const existing = buckets.get(sig);
    if (existing) {
      existing.count += 1;
      if (row.created_at < existing.firstSeenAt) existing.firstSeenAt = row.created_at;
      if (row.created_at > existing.lastSeenAt) {
        existing.lastSeenAt = row.created_at;
        existing.sourceSessionId = row.session_id;
        existing.sourceMessageId = row.id;
      }
      addExample(existing.examples, example);
    } else {
      buckets.set(sig, {
        signature: sig,
        toolName: row.tool_name,
        argsPreview: preview,
        count: 1,
        firstSeenAt: row.created_at,
        lastSeenAt: row.created_at,
        sourceSessionId: row.session_id,
        sourceMessageId: row.id,
        examples: [example],
      });
    }
  }
  return [...buckets.values()]
    .filter((p) => p.count >= MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count);
}

function parseArgs(raw: string | null): Record<string, unknown> {
  const parsed = parseJson(raw);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseJson(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
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

function addExample(
  examples: DetectedPatternExample[],
  example: DetectedPatternExample,
): void {
  examples.push(example);
  examples.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (examples.length > MAX_EXAMPLES) examples.length = MAX_EXAMPLES;
}
