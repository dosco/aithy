import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type {
  LogicalSessionInput,
  MessagePage,
  SessionStateStore,
  StoredSession,
} from "./state-store";
import { HOME_SESSION_ID } from "./home-session";
import type {
  BotMessage,
  BotSessionSummary,
} from "./types";
import type { MessageRow, SessionRow } from "./sqlite-session-schema";
import { sessionMigrations } from "./sqlite-session-schema";
import {
  messageRowsToEntries,
  messageToBindings,
  summaryFromRow,
} from "./sqlite-session-helpers";
import { applySqliteMigrations } from "../sqlite/migrations";
import { migrateSessionMountsToGlobal } from "./sqlite-session-legacy-migrations";

interface MessageRowWithId extends MessageRow {
  id: number;
}

export class SqliteSessionStateStore implements SessionStateStore {
  private readonly db: Database;

  constructor(private readonly dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.migrate();
    migrateSessionMountsToGlobal(this.db);
  }

  ensureSession(input: LogicalSessionInput): void {
    this.db.query(`
      INSERT INTO sessions (
        id, name, name_source, source, model, system_prompt,
        parent_session_id, parent_message_id, created_at, updated_at, expires_at
      )
      VALUES (
        $id, $name, $nameSource, $source, $model, $systemPrompt,
        $parentSessionId, $parentMessageId, $createdAt, $updatedAt, $expiresAt
      )
      ON CONFLICT(id) DO NOTHING
    `).run({
      $id: input.conversationId,
      $name: input.name,
      $nameSource: input.nameSource,
      $source: input.source,
      $model: input.model ?? null,
      $systemPrompt: input.systemPrompt ?? null,
      $parentSessionId: input.parentSessionId ?? null,
      $parentMessageId: input.parentMessageId ?? null,
      $createdAt: input.now,
      $updatedAt: input.now,
      $expiresAt: input.expiresAt.toISOString(),
    });
  }

  childSessions(parentId: string): BotSessionSummary[] {
    const rows = this.db.query(`
      SELECT * FROM sessions
      WHERE parent_session_id = $id
      ORDER BY created_at ASC
    `).all({ $id: parentId }) as SessionRow[];
    return rows.map(summaryFromRow);
  }

  /** Returns the rowid of the most recently inserted message in a session. */
  lastMessageId(conversationId: string): number | null {
    const row = this.db.query(`
      SELECT id FROM messages WHERE session_id = $id ORDER BY id DESC LIMIT 1
    `).get({ $id: conversationId }) as { id: number } | undefined;
    return row?.id ?? null;
  }

  loadSession(conversationId: string): StoredSession | undefined {
    const row = this.sessionRow(conversationId);
    if (!row) return undefined;
    return {
      ...summaryFromRow(row),
      messages: this.messages(conversationId),
    };
  }

  listSessions(): BotSessionSummary[] {
    const rows = this.db.query(`
      SELECT * FROM sessions
      WHERE id != $homeSessionId
      ORDER BY updated_at DESC, created_at DESC
    `).all({ $homeSessionId: HOME_SESSION_ID }) as SessionRow[];
    return rows.map(summaryFromRow);
  }

  findSessionsByName(name: string): BotSessionSummary[] {
    const rows = this.db.query(`
      SELECT * FROM sessions
      WHERE name = $name
      ORDER BY updated_at DESC, created_at DESC
    `).all({ $name: name }) as SessionRow[];
    return rows.map(summaryFromRow);
  }

  getSummary(conversationId: string): BotSessionSummary | undefined {
    const row = this.sessionRow(conversationId);
    return row ? summaryFromRow(row) : undefined;
  }

  renameSession(conversationId: string, name: string): void {
    this.db.query(`
      UPDATE sessions
      SET name = $name, name_source = 'manual', updated_at = $updatedAt
      WHERE id = $id
    `).run({
      $id: conversationId,
      $name: name.trim(),
      $updatedAt: new Date().toISOString(),
    });
  }

  clearSession(conversationId: string, now: string): void {
    this.db.query("DELETE FROM messages WHERE session_id = $id").run({
      $id: conversationId,
    });
    this.db.query(`
      UPDATE sessions
      SET updated_at = $updatedAt,
          input_tokens = 0,
          output_tokens = 0,
          thought_tokens = 0,
          total_tokens = 0
      WHERE id = $id
    `).run({ $id: conversationId, $updatedAt: now });
  }

  deleteSession(conversationId: string): void {
    this.db.query("DELETE FROM sessions WHERE id = $id").run({
      $id: conversationId,
    });
  }

  deleteAllSessions(): void {
    this.db.query("DELETE FROM sessions").run();
  }

  appendMessages(conversationId: string, messages: BotMessage[]): void {
    if (messages.length === 0) return;
    const insert = this.db.query(`
      INSERT INTO messages (
        session_id, role, message_kind, content, metadata_json, thought,
        tool_name, tool_args, tool_result,
        input_tokens, output_tokens, thought_tokens, total_tokens,
        created_at
      )
      VALUES (
        $sessionId, $role, $messageKind, $content, $metadataJson, $thought,
        $toolName, $toolArgs, $toolResult,
        $inputTokens, $outputTokens, $thoughtTokens, $totalTokens,
        $createdAt
      )
    `);
    let inputTokens = 0;
    let outputTokens = 0;
    let thoughtTokens = 0;
    let totalTokens = 0;
    let updatedAt = new Date().toISOString();
    for (const message of messages) {
      insert.run({ $sessionId: conversationId, ...messageToBindings(message) });
      updatedAt = message.createdAt;
      const usage = assistantUsage(message);
      if (usage) {
        inputTokens += usage.input;
        outputTokens += usage.output;
        thoughtTokens += usage.thought;
        totalTokens += usage.total;
      }
    }
    this.db.query(`
      UPDATE sessions
      SET updated_at = $updatedAt,
          input_tokens = input_tokens + $inputTokens,
          output_tokens = output_tokens + $outputTokens,
          thought_tokens = thought_tokens + $thoughtTokens,
          total_tokens = total_tokens + $totalTokens
      WHERE id = $sessionId
    `).run({
      $sessionId: conversationId,
      $updatedAt: updatedAt,
      $inputTokens: inputTokens,
      $outputTokens: outputTokens,
      $thoughtTokens: thoughtTokens,
      $totalTokens: totalTokens,
    });
  }

  messagesPage(conversationId: string, input: { beforeId?: number | null; limit: number }): MessagePage {
    const limit = Math.max(1, Math.floor(input.limit));
    const beforeId = input.beforeId ?? null;
    const rows = this.db.query(`
      SELECT id, role, message_kind, content, metadata_json, thought,
             tool_name, tool_args, tool_result,
             input_tokens, output_tokens, thought_tokens, total_tokens,
             created_at
      FROM messages
      WHERE session_id = $id
        AND ($beforeId IS NULL OR id < $beforeId)
      ORDER BY id DESC
      LIMIT $limit
    `).all({
      $id: conversationId,
      $beforeId: beforeId,
      $limit: limit,
    }) as MessageRowWithId[];
    rows.reverse();
    const oldestId = rows[0]?.id ?? null;
    const newestId = rows.at(-1)?.id ?? null;
    const hasMoreBefore = oldestId == null
      ? false
      : Boolean(this.db.query(`
          SELECT 1 FROM messages
          WHERE session_id = $id AND id < $oldestId
          LIMIT 1
        `).get({ $id: conversationId, $oldestId: oldestId }));
    return {
      items: rows.map((row) => ({ id: row.id, message: messageRowsToEntries([row])[0] })),
      oldestId,
      newestId,
      hasMoreBefore,
    };
  }

  messagesByIdRange(
    conversationId: string,
    input: { startId: number; endId: number; limit: number },
  ): Array<{ id: number; message: BotMessage }> {
    const startId = Math.max(1, Math.floor(Math.min(input.startId, input.endId)));
    const endId = Math.max(startId, Math.floor(Math.max(input.startId, input.endId)));
    const limit = Math.max(1, Math.floor(input.limit));
    const rows = this.db.query(`
      SELECT id, role, message_kind, content, metadata_json, thought,
             tool_name, tool_args, tool_result,
             input_tokens, output_tokens, thought_tokens, total_tokens,
             created_at
      FROM messages
      WHERE session_id = $id
        AND id >= $startId
        AND id <= $endId
      ORDER BY id ASC
      LIMIT $limit
    `).all({
      $id: conversationId,
      $startId: startId,
      $endId: endId,
      $limit: limit,
    }) as MessageRowWithId[];
    const messages = messageRowsToEntries(rows);
    return rows.map((row, index) => ({ id: row.id, message: messages[index] }));
  }

  private migrate(): void {
    applySqliteMigrations(this.db, "session", sessionMigrations);
  }

  private sessionRow(conversationId: string): SessionRow | undefined {
    return this.db.query(`
      SELECT * FROM sessions WHERE id = $id
    `).get({ $id: conversationId }) as SessionRow | undefined;
  }

  private messages(conversationId: string): BotMessage[] {
    const rows = this.messageRowsWithIds(conversationId);
    return messageRowsToEntries(rows);
  }

  private messageRowsWithIds(conversationId: string): MessageRowWithId[] {
    return this.db.query(`
      SELECT id, role, message_kind, content, metadata_json, thought,
             tool_name, tool_args, tool_result,
             input_tokens, output_tokens, thought_tokens, total_tokens,
             created_at
      FROM messages
      WHERE session_id = $id
      ORDER BY id ASC
    `).all({ $id: conversationId }) as MessageRowWithId[];
  }

  close(): void {
    this.db.close();
  }
}

function assistantUsage(message: BotMessage) {
  if (message.role !== "assistant") return undefined;
  if (message.kind !== "text" && message.kind !== "tool_call") return undefined;
  return message.usage;
}
