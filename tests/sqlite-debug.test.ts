import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { renderSqliteDebug } from "../src/debug/sqlite-debug";

describe("renderSqliteDebug", () => {
  test("lists tables when no table is selected", async () => {
    const db = new Database(await seededDbPath(), { readonly: true });
    const output = renderSqliteDebug(db);
    expect(output).toContain("sessions");
    expect(output).toContain("metadata");
    db.close();
  });

  test("renders a table and looks up rows by id", async () => {
    const db = new Database(await seededDbPath(), { readonly: true });
    const tableOutput = renderSqliteDebug(db, { table: "sessions" });
    expect(tableOutput).toContain("Table: sessions");
    expect(tableOutput).toContain("conversation");

    const lookupOutput = renderSqliteDebug(db, { table: "metadata", id: "soul.md" });
    expect(lookupOutput).toContain("Lookup column: key");
    expect(lookupOutput).toContain("soul.md");
    db.close();
  });
});

async function seededDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-debug-"));
  const dbPath = path.join(dir, "state.db");
  const db = new Database(dbPath, { create: true });
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      agent_state_json TEXT
    );
    CREATE TABLE session_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attachments_json TEXT,
      artifacts_json TEXT
    );
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      hash TEXT
    );

    INSERT INTO sessions (
      id, name, name_source, created_at, updated_at, expires_at, agent_state_json
    ) VALUES (
      'conversation', 'Debug Session', 'manual',
      '2026-05-02T12:00:00.000Z', '2026-05-02T12:00:00.000Z', '2026-05-02T13:00:00.000Z',
      NULL
    );

    INSERT INTO metadata (key, value, hash) VALUES (
      'soul.md',
      '{"sourceHash":"abc","processedHash":"def","responderDescription":"kind"}',
      'abc'
    );
  `);
  db.close();
  return dbPath;
}
