import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { sessionMigrations, type MessageRow } from "../session/sqlite-session-schema";
import { applySqliteMigrations } from "../sqlite/migrations";
import { retrievalDiagnostics, sourceStats, type RetrievalDiagnostics } from "./diagnostics";
import { addFusedHit, sortedFused, type FusedCandidate } from "./fusion";
import { buildRetrievalQueryPlan } from "./query-plan";

interface TranscriptRow extends MessageRow {
  id: number;
  session_id: string;
  bm25?: number;
}

export interface TranscriptRecallEntry {
  id: string;
  sessionId: string;
  messageId: number;
  createdAt: string;
  content: string;
}

export class SqliteTranscriptRecallStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "session", sessionMigrations);
  }

  searchDetailed(
    queries: readonly string[],
    opts: { limit: number; beforeCreatedAt?: string; excludeIds?: readonly string[] } = { limit: 5 },
  ): { entries: TranscriptRecallEntry[]; diagnostics: RetrievalDiagnostics } {
    const startedAt = performance.now();
    const plan = buildRetrievalQueryPlan(queries);
    if (plan.lexicalQueries.length === 0 || !this.tableExists("messages_fts")) {
      return {
        entries: [],
        diagnostics: retrievalDiagnostics({
          source: "store",
          mode: "fts-only",
          queryCount: queries.length,
          startedAt,
          sources: [sourceStats({ source: "transcripts" })],
        }),
      };
    }

    const exclude = new Set(opts.excludeIds ?? []);
    const fused = new Map<string, FusedCandidate<TranscriptRow>>();
    let ftsCandidates = 0;
    for (const query of plan.lexicalQueries) {
      const rows = this.db
        .query(
          `SELECT m.id, m.session_id, m.role, m.message_kind, m.content, m.metadata_json, m.thought,
                  m.tool_name, m.tool_args, m.tool_result, m.input_tokens, m.output_tokens,
                  m.thought_tokens, m.total_tokens, m.created_at, bm25(messages_fts) AS bm25
             FROM messages_fts f
             JOIN messages m ON m.id = f.rowid
            WHERE messages_fts MATCH $match
              AND ($beforeCreatedAt IS NULL OR m.created_at < $beforeCreatedAt)
            ORDER BY rank
            LIMIT $limit`,
        )
        .all({
          $match: query.expression,
          $beforeCreatedAt: opts.beforeCreatedAt ?? null,
          $limit: 30,
        } as never) as TranscriptRow[];
      ftsCandidates += rows.length;
      rows
        .filter((row) => !exclude.has(`${row.session_id}:${row.id}`))
        .forEach((row, rank) => addFusedHit(fused, `${row.session_id}:${row.id}`, row, query.lane, rank));
    }

    const entries = sortedFused(fused)
      .slice(0, Math.max(1, opts.limit))
      .map((candidate) => this.entry(candidate.item));
    return {
      entries,
      diagnostics: retrievalDiagnostics({
        source: "store",
        mode: "fts-only",
        queryCount: queries.length,
        startedAt,
        sources: [sourceStats({
          source: "transcripts",
          ftsCandidates,
          fusedCandidates: fused.size,
          finalMatches: entries.length,
        })],
      }),
    };
  }

  close(): void {
    this.db.close();
  }

  private entry(row: TranscriptRow): TranscriptRecallEntry {
    const start = Math.max(1, row.id - 1);
    const end = row.id + 1;
    const rows = this.db
      .query(
        `SELECT id, session_id, role, message_kind, content, metadata_json, thought,
                tool_name, tool_args, tool_result, input_tokens, output_tokens,
                thought_tokens, total_tokens, created_at
           FROM messages
          WHERE session_id = $sessionId AND id BETWEEN $start AND $end
          ORDER BY id ASC`,
      )
      .all({ $sessionId: row.session_id, $start: start, $end: end }) as TranscriptRow[];
    return {
      id: `${row.session_id}:${row.id}`,
      sessionId: row.session_id,
      messageId: row.id,
      createdAt: row.created_at,
      content: [
        `# Raw transcript evidence`,
        `session: ${row.session_id}; message: #${row.id}`,
        "",
        ...rows.map(formatTranscriptLine),
      ].join("\n"),
    };
  }

  private tableExists(name: string): boolean {
    const row = this.db
      .query("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = $name")
      .get({ $name: name }) as { name: string } | undefined;
    return Boolean(row);
  }
}

function formatTranscriptLine(row: TranscriptRow): string {
  const prefix = `#${row.id}`;
  if (row.role === "user") return `${prefix} user: ${compact(row.content ?? "")}`;
  if (row.message_kind === "tool_call" || row.tool_name) {
    return `${prefix} tool ${row.tool_name ?? "unknown"}: args=${compact(row.tool_args ?? "null")} result=${compact(row.tool_result ?? "null")}`;
  }
  if (row.message_kind === "artifact") {
    return `${prefix} artifact: ${compact(row.metadata_json ?? "")}`;
  }
  if (row.message_kind === "permission") {
    return `${prefix} permission: ${compact(row.metadata_json ?? "")}`;
  }
  return `${prefix} assistant: ${compact(row.content ?? "")}`;
}

function compact(value: string, maxChars = 800): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 12)} [truncated]`;
}
