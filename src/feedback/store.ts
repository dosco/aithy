import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";

const HISTORY_ITEMS = 12;
const HISTORY_CHARS = 16_000;

export interface ChatFeedback {
  id: string; sessionId: string; messageId: number; verdict: "up" | "down"; comment: string | null;
  assistantResponse: string; precedingRequest: string; history: Array<{ role: string; content: string }>;
  createdAt: string; updatedAt: string;
}

export class SqliteFeedbackStore {
  private readonly db: Database;
  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true }); this.db.exec("PRAGMA foreign_keys = ON;");
    applySqliteMigrations(this.db, "feedback", [{ version: 1, sql: `
      CREATE TABLE chat_feedback (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        message_id INTEGER NOT NULL, verdict TEXT NOT NULL, comment TEXT,
        assistant_response TEXT NOT NULL, preceding_request TEXT NOT NULL, history_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id, message_id)
      );
      CREATE INDEX chat_feedback_updated_idx ON chat_feedback(updated_at DESC);
    ` }]);
  }

  upsert(input: { sessionId: string; messageId: number; verdict: "up" | "down"; comment?: string | null }): ChatFeedback {
    const evidence = this.captureEvidence(input.sessionId, input.messageId);
    const existing = this.byMessage(input.sessionId, input.messageId);
    const now = new Date().toISOString();
    const entry: ChatFeedback = { id: existing?.id ?? crypto.randomUUID(), sessionId: input.sessionId,
      messageId: input.messageId, verdict: input.verdict, comment: cleanComment(input.comment), ...evidence,
      createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.db.query(`INSERT INTO chat_feedback (id, session_id, message_id, verdict, comment, assistant_response,
      preceding_request, history_json, created_at, updated_at)
      VALUES ($id, $sessionId, $messageId, $verdict, $comment, $assistantResponse, $precedingRequest, $history, $createdAt, $updatedAt)
      ON CONFLICT(session_id, message_id) DO UPDATE SET verdict = excluded.verdict, comment = excluded.comment,
      assistant_response = excluded.assistant_response, preceding_request = excluded.preceding_request,
      history_json = excluded.history_json, updated_at = excluded.updated_at`).run(bind(entry));
    return entry;
  }

  get(id: string): ChatFeedback | null { const row = this.db.query("SELECT * FROM chat_feedback WHERE id = $id").get({ $id: id }); return row ? fromRow(row as FeedbackRow) : null; }
  byMessage(sessionId: string, messageId: number): ChatFeedback | null { const row = this.db.query("SELECT * FROM chat_feedback WHERE session_id = $sessionId AND message_id = $messageId")
    .get({ $sessionId: sessionId, $messageId: messageId }); return row ? fromRow(row as FeedbackRow) : null; }
  close(): void { this.db.close(); }

  private captureEvidence(sessionId: string, messageId: number) {
    const assistant = this.db.query("SELECT role, content FROM messages WHERE id = $id AND session_id = $sessionId")
      .get({ $id: messageId, $sessionId: sessionId }) as { role: string; content: string | null } | undefined;
    if (!assistant || assistant.role !== "assistant" || !assistant.content) throw new Error("Feedback target must be a persisted assistant text message.");
    const preceding = this.db.query("SELECT content FROM messages WHERE session_id = $sessionId AND id < $id AND role = 'user' AND content IS NOT NULL ORDER BY id DESC LIMIT 1")
      .get({ $sessionId: sessionId, $id: messageId }) as { content: string } | undefined;
    if (!preceding?.content) throw new Error("Feedback target has no preceding user request.");
    const rows = this.db.query("SELECT role, content FROM messages WHERE session_id = $sessionId AND id <= $id AND content IS NOT NULL ORDER BY id DESC LIMIT $limit")
      .all({ $sessionId: sessionId, $id: messageId, $limit: HISTORY_ITEMS }) as Array<{ role: string; content: string }>;
    const history = rows.reverse().map((row) => ({ role: row.role, content: row.content })).filter((item) => item.content);
    while (JSON.stringify(history).length > HISTORY_CHARS && history.length > 1) history.shift();
    return { assistantResponse: assistant.content.slice(0, 32_000), precedingRequest: preceding.content.slice(0, 8_000), history };
  }
}

interface FeedbackRow { id: string; session_id: string; message_id: number; verdict: "up" | "down"; comment: string | null; assistant_response: string; preceding_request: string; history_json: string; created_at: string; updated_at: string }
function fromRow(row: FeedbackRow): ChatFeedback { return { id: row.id, sessionId: row.session_id, messageId: row.message_id, verdict: row.verdict,
  comment: row.comment, assistantResponse: row.assistant_response, precedingRequest: row.preceding_request,
  history: JSON.parse(row.history_json), createdAt: row.created_at, updatedAt: row.updated_at }; }
function bind(entry: ChatFeedback) { return { $id: entry.id, $sessionId: entry.sessionId, $messageId: entry.messageId, $verdict: entry.verdict,
  $comment: entry.comment, $assistantResponse: entry.assistantResponse, $precedingRequest: entry.precedingRequest,
  $history: JSON.stringify(entry.history), $createdAt: entry.createdAt, $updatedAt: entry.updatedAt }; }
function cleanComment(value: string | null | undefined): string | null { const clean = value?.trim(); return clean ? clean.slice(0, 4_000) : null; }
