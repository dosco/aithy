import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations, type SqliteMigration } from "../sqlite/migrations";
import { messageRowsToEntries } from "../session/sqlite-session-helpers";
import type { MessageRow } from "../session/sqlite-session-schema";
import type { BotMessage } from "../session/types";

const AUTO_CURSOR_KEY = "auto";

const migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE memory_extraction_state (
        key TEXT PRIMARY KEY CHECK (key = 'auto'),
        last_message_id INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      INSERT INTO memory_extraction_state(key, last_message_id, updated_at)
      VALUES ('auto', 0, datetime('now'));
    `,
  },
];

interface StoredMessageRow extends MessageRow {
  id: number;
  session_id: string;
  parent_session_id: string | null;
}

export interface MemoryExtractionMessage {
  id: number;
  sessionId: string;
  kind: "context" | "new";
  message: BotMessage;
}

export interface MemoryExtractionSegment {
  sessionId: string;
  messages: MemoryExtractionMessage[];
  newMessages: MemoryExtractionMessage[];
}

export interface MemoryExtractionBatch {
  startCursor: number;
  nextCursor: number;
  inspectedCount: number;
  segments: MemoryExtractionSegment[];
}

export class SqliteMemoryExtractionStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "memory_extraction", migrations);
  }

  cursor(): number {
    const row = this.db
      .query("SELECT last_message_id FROM memory_extraction_state WHERE key = $key")
      .get({ $key: AUTO_CURSOR_KEY }) as { last_message_id: number } | undefined;
    return row?.last_message_id ?? 0;
  }

  setCursor(messageId: number): void {
    const normalized = Math.max(0, Math.floor(messageId));
    this.db
      .query(
        `INSERT INTO memory_extraction_state(key, last_message_id, updated_at)
         VALUES ($key, $messageId, $updatedAt)
         ON CONFLICT(key) DO UPDATE SET
           last_message_id = excluded.last_message_id,
           updated_at = excluded.updated_at
         WHERE excluded.last_message_id > memory_extraction_state.last_message_id`,
      )
      .run({
        $key: AUTO_CURSOR_KEY,
        $messageId: normalized,
        $updatedAt: new Date().toISOString(),
      });
  }

  loadBatch(input: { limit: number; overlap: number }): MemoryExtractionBatch {
    const startCursor = this.cursor();
    const inspected = this.fetchMessagesAfter(startCursor, input.limit);
    const nextCursor = inspected.at(-1)?.id ?? startCursor;
    const topLevel = inspected.filter((row) => row.parent_session_id === null);
    const segments = this.buildSegments(topLevel, Math.max(0, Math.floor(input.overlap)));
    return {
      startCursor,
      nextCursor,
      inspectedCount: inspected.length,
      segments,
    };
  }

  close(): void {
    this.db.close();
  }

  private fetchMessagesAfter(cursor: number, limit: number): StoredMessageRow[] {
    return this.db
      .query(
        `SELECT m.id, m.session_id, m.role, m.message_kind, m.content, m.metadata_json,
                m.thought, m.tool_name, m.tool_args, m.tool_result,
                m.input_tokens, m.output_tokens, m.thought_tokens, m.total_tokens,
                m.created_at, s.parent_session_id
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE m.id > $cursor
         ORDER BY m.id ASC
         LIMIT $limit`,
      )
      .all({
        $cursor: Math.max(0, Math.floor(cursor)),
        $limit: Math.max(1, Math.floor(limit)),
      }) as StoredMessageRow[];
  }

  private buildSegments(rows: readonly StoredMessageRow[], overlap: number): MemoryExtractionSegment[] {
    const grouped = groupBySession(rows);
    const segments: MemoryExtractionSegment[] = [];
    for (const [sessionId, newRows] of grouped) {
      const overlapRows = overlap > 0 ? this.fetchOverlap(sessionId, newRows[0].id, overlap) : [];
      const context = overlapRows.map((row) => toExtractionMessage(row, "context"));
      const fresh = newRows.map((row) => toExtractionMessage(row, "new"));
      segments.push({
        sessionId,
        messages: [...context, ...fresh],
        newMessages: fresh,
      });
    }
    return segments;
  }

  private fetchOverlap(sessionId: string, beforeId: number, limit: number): StoredMessageRow[] {
    const rows = this.db
      .query(
        `SELECT m.id, m.session_id, m.role, m.message_kind, m.content, m.metadata_json,
                m.thought, m.tool_name, m.tool_args, m.tool_result,
                m.input_tokens, m.output_tokens, m.thought_tokens, m.total_tokens,
                m.created_at, s.parent_session_id
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE m.session_id = $sessionId AND m.id < $beforeId
         ORDER BY m.id DESC
         LIMIT $limit`,
      )
      .all({ $sessionId: sessionId, $beforeId: beforeId, $limit: limit }) as StoredMessageRow[];
    return rows.reverse();
  }
}

function groupBySession(rows: readonly StoredMessageRow[]): Map<string, StoredMessageRow[]> {
  const grouped = new Map<string, StoredMessageRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.session_id);
    if (existing) existing.push(row);
    else grouped.set(row.session_id, [row]);
  }
  return grouped;
}

function toExtractionMessage(row: StoredMessageRow, kind: "context" | "new"): MemoryExtractionMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind,
    message: messageRowsToEntries([row])[0],
  };
}
