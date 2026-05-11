import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { BotMessage } from "../src/session/types";

describe("SqliteSessionStateStore", () => {
  test("migrates and persists sessions and messages", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteSessionStateStore(dbPath);
    const now = "2026-05-02T12:00:00.000Z";

    store.ensureSession({
      conversationId: "conversation",
      name: "Initial",
      nameSource: "manual",
      source: "cli",
      now,
      expiresAt: new Date("2026-05-02T13:00:00.000Z"),
    });

    const userMsg: BotMessage = {
      role: "user",
      content: "remember sqlite",
      createdAt: now,
    };
    const toolCallMsg: BotMessage = {
      role: "assistant",
      kind: "tool_call",
      toolName: "search",
      toolArgs: { q: "aithy" },
      toolResult: { ok: true, value: { hits: 3 } },
      thought: "let me search",
      usage: { input: 10, output: 0, thought: 5, total: 15 },
      createdAt: now,
    };
    const textMsg: BotMessage = {
      role: "assistant",
      kind: "text",
      content: "found it",
      usage: { input: 8, output: 4, thought: 0, total: 12 },
      createdAt: now,
    };

    store.renameSession("conversation", "Saved");
    store.appendMessages("conversation", [userMsg, toolCallMsg, textMsg]);

    const reopened = new SqliteSessionStateStore(dbPath);
    const loaded = reopened.loadSession("conversation");
    expect(loaded?.name).toBe("Saved");
    expect(loaded?.source).toBe("cli");
    expect(loaded?.tokenTotals).toEqual({ input: 18, output: 4, thought: 5, total: 27 });
    expect(loaded?.messages).toMatchObject([
      { role: "user", content: "remember sqlite" },
      {
        role: "assistant",
        kind: "tool_call",
        toolName: "search",
        toolArgs: { q: "aithy" },
        toolResult: { ok: true, value: { hits: 3 } },
        thought: "let me search",
        usage: { input: 10, output: 0, thought: 5, total: 15 },
      },
      {
        role: "assistant",
        kind: "text",
        content: "found it",
        usage: { input: 8, output: 4, thought: 0, total: 12 },
      },
    ]);

    const migrations = new Database(dbPath).query(`
      SELECT scope, version FROM schema_migrations
      WHERE scope = 'session'
      ORDER BY version
    `).all();
    expect(migrations).toEqual([
      { scope: "session", version: 1 },
      { scope: "session", version: 2 },
      { scope: "session", version: 3 },
      { scope: "session", version: 4 },
      { scope: "session", version: 5 },
    ]);
    expect(new Database(dbPath).query(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'
    `).get()).toBeTruthy();
    expect(new Database(dbPath).query(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_items'
    `).get()).toBeFalsy();
  });

  test("migrates legacy session_mounts rows into web.settings.globalMounts and drops the table", async () => {
    const dbPath = await tempDbPath();
    // Build a legacy DB shape: pretend an older version of the schema where
    // `session_mounts` exists with rows. We set the schema_migrations marker
    // for v1..v3 so applySqliteMigrations doesn't try to recreate them.
    const seed = new Database(dbPath, { create: true });
    seed.exec(`
      CREATE TABLE schema_migrations (
        scope TEXT NOT NULL, version INTEGER NOT NULL, applied_at TEXT NOT NULL,
        PRIMARY KEY (scope, version)
      );
      INSERT INTO schema_migrations(scope,version,applied_at) VALUES ('session',1,'now'),('session',2,'now'),('session',3,'now');
      CREATE TABLE sessions (id TEXT PRIMARY KEY, name TEXT, name_source TEXT, source TEXT, model TEXT, system_prompt TEXT, parent_session_id TEXT, parent_message_id INTEGER, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, thought_tokens INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, expires_at TEXT);
      INSERT INTO sessions(id,name,name_source,source,created_at,updated_at,expires_at) VALUES ('c1','x','generated','test','t','t','t');
      CREATE TABLE session_mounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        host_path TEXT NOT NULL,
        mount_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, host_path)
      );
      INSERT INTO session_mounts(session_id,host_path,mount_name,created_at) VALUES
        ('c1','/host/a','a-1','t'),('c1','/host/b','b-2','t');
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, hash TEXT);
      INSERT INTO metadata(key,value,hash) VALUES (
        'web.settings',
        '{"runtime":{"globalMounts":[{"hostPath":"/host/a"}]},"ui":{},"updatedAt":"old"}',
        NULL
      );
    `);
    seed.close();

    new SqliteSessionStateStore(dbPath);

    const post = new Database(dbPath);
    const stillExists = post.query(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_mounts'`,
    ).get();
    expect(stillExists).toBeFalsy();

    const settings = JSON.parse(
      (post.query(`SELECT value FROM metadata WHERE key = 'web.settings'`).get() as { value: string }).value,
    );
    expect(settings.runtime.globalMounts).toEqual([
      { hostPath: "/host/a" },
      { hostPath: "/host/b" },
    ]);
  });

  test("renames, finds, and clears messages", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteSessionStateStore(dbPath);
    seedSession(store, "Before");
    store.appendMessages("conversation", [{
        role: "assistant",
        kind: "text",
        content: "question?",
        createdAt: "now",
      }]);

    store.renameSession("conversation", "After");
    expect(store.findSessionsByName("After")[0]?.conversationId).toBe("conversation");

    store.clearSession("conversation", "2026-05-02T12:00:00.000Z");
    const loaded = store.loadSession("conversation");
    expect(loaded?.messages).toEqual([]);
    expect(loaded?.tokenTotals).toEqual({ input: 0, output: 0, thought: 0, total: 0 });
  });

  test("deletes sessions and cascades messages", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteSessionStateStore(dbPath);
    seedSession(store);
    store.appendMessages("conversation", [{
        role: "assistant",
        kind: "text",
        content: "delete me",
        createdAt: "now",
      }]);

    store.deleteSession("conversation");

    expect(store.getSummary("conversation")).toBeUndefined();
    expect(store.loadSession("conversation")).toBeUndefined();
    const db = new Database(dbPath);
    const row = db.query("SELECT COUNT(*) AS c FROM messages").get() as { c: number };
    expect(row.c).toBe(0);
    db.close();
  });

  test("pages newest messages and older messages by stable id", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteSessionStateStore(dbPath);
    seedSession(store);

    const messages = Array.from({ length: 12 }, (_, index): BotMessage => ({
      role: "user",
      content: `message ${index + 1}`,
      createdAt: `2026-05-02T12:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    store.appendMessages("conversation", messages.slice(0, 6));
    store.appendMessages("conversation", messages.slice(6));

    const latest = store.messagesPage("conversation", { limit: 10 });
    expect(latest.items.map((item) => item.message)).toMatchObject([
      { content: "message 3" },
      { content: "message 4" },
      { content: "message 5" },
      { content: "message 6" },
      { content: "message 7" },
      { content: "message 8" },
      { content: "message 9" },
      { content: "message 10" },
      { content: "message 11" },
      { content: "message 12" },
    ]);
    expect(latest.hasMoreBefore).toBe(true);

    const older = store.messagesPage("conversation", {
      beforeId: latest.oldestId,
      limit: 10,
    });
    expect(older.items.map((item) => item.message)).toMatchObject([
      { content: "message 1" },
      { content: "message 2" },
    ]);
    expect(older.hasMoreBefore).toBe(false);

    store.appendMessages("conversation", [{
      role: "user",
      content: "message 13",
      createdAt: "2026-05-02T12:00:12.000Z",
    }]);
    const stillOlder = store.messagesPage("conversation", {
      beforeId: latest.oldestId,
      limit: 10,
    });
    expect(stillOlder.items.map((item) => item.message)).toMatchObject([
      { content: "message 1" },
      { content: "message 2" },
    ]);
  });
});

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-state-"));
  return path.join(dir, "state.db");
}

function seedSession(store: SqliteSessionStateStore, name = "Session"): void {
  store.ensureSession({
    conversationId: "conversation",
    name,
    nameSource: "manual",
    source: "cli",
    now: "2026-05-02T12:00:00.000Z",
    expiresAt: new Date("2026-05-02T13:00:00.000Z"),
  });
}
