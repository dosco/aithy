import { applySqliteMigrations, type SqliteMigration } from "../sqlite/migrations";
import { hasColumn } from "./runtime-store-rows";
import type { Database } from "bun:sqlite";

const migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS runtime_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        conversation_id TEXT,
        stream_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS runtime_events_tail_idx ON runtime_events(id);
      CREATE INDEX IF NOT EXISTS runtime_events_expiry_idx ON runtime_events(expires_at);

      CREATE TABLE IF NOT EXISTS runtime_commands (
        id TEXT PRIMARY KEY,
        target_role TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        detail_json TEXT
      );
      CREATE INDEX IF NOT EXISTS runtime_commands_pending_idx
        ON runtime_commands(target_role, status, created_at);

      CREATE TABLE IF NOT EXISTS runtime_services (
        role TEXT PRIMARY KEY,
        pid INTEGER,
        status TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        detail_json TEXT
      );

      CREATE TABLE IF NOT EXISTS capability_grants (
        id TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        scope TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS capability_grants_lookup_idx
        ON capability_grants(capability, scope, created_at);

      CREATE TABLE IF NOT EXISTS tool_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        capability TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        reason TEXT NOT NULL,
        args_preview TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tool_audit_log_created_idx ON tool_audit_log(created_at);
    `,
  },
  {
    version: 2,
    precondition: (db) => !hasColumn(db, "runtime_commands", "claimed_at"),
    sql: `
      ALTER TABLE runtime_commands ADD COLUMN claimed_at TEXT;
      ALTER TABLE runtime_commands ADD COLUMN completed_at TEXT;
      ALTER TABLE runtime_commands ADD COLUMN detail_json TEXT;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS permission_requests (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        reason TEXT NOT NULL,
        args_preview TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decision_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS permission_requests_lookup_idx
        ON permission_requests(conversation_id, status, created_at);
    `,
  },
];

export function applyRuntimeStoreMigrations(db: Database): void {
  applySqliteMigrations(db, "runtime", migrations);
}
