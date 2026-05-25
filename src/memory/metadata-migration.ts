import type { Database } from "bun:sqlite";
import type { SqliteMigration } from "../sqlite/migrations";

const MEMORY_SUBJECT_VALUES = ["'user'", "'agent'", "'project'"].join(", ");
const MEMORY_SCOPE_VALUES = ["'global'", "'workspace'", "'session'"].join(", ");
const MEMORY_GUIDANCE_VALUES = ["'context'", "'standing_request'"].join(", ");

export function memoryMetadataMigration(memoryKindValues: string): SqliteMigration {
  return {
    version: 10,
    precondition: (db) => {
      const columns = memoryColumns(db);
      if (!columns.some((row) => row.name === "subject")) return true;
      return !(memoryTableSql(db)?.includes("'lesson'") ?? false);
    },
    sql: `
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;
      DROP TABLE IF EXISTS memories_fts;

      CREATE TABLE memories_new (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN (${memoryKindValues})),
        subject TEXT NOT NULL CHECK (subject IN (${MEMORY_SUBJECT_VALUES})),
        scope_kind TEXT NOT NULL CHECK (scope_kind IN (${MEMORY_SCOPE_VALUES})),
        scope_ref TEXT,
        guidance TEXT NOT NULL CHECK (guidance IN (${MEMORY_GUIDANCE_VALUES})),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        duration_days INTEGER,
        evidence TEXT,
        frequency TEXT,
        source TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_recalled_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0,
        retrieved_count INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT REFERENCES memories_new(id) ON DELETE SET NULL
      );

      INSERT INTO memories_new (
        rowid, id, kind, subject, scope_kind, scope_ref, guidance, title, body,
        valid_from, valid_until, duration_days, evidence, frequency, source, importance,
        created_at, updated_at, last_recalled_at, recall_count, retrieved_count, superseded_by
      )
      SELECT
        rowid,
        id,
        CASE
          WHEN kind IN (${memoryKindValues}) THEN kind
          WHEN kind = 'episode' THEN 'event'
          ELSE 'fact'
        END,
        'user',
        'global',
        NULL,
        CASE WHEN kind = 'instruction' THEN 'standing_request' ELSE 'context' END,
        title,
        body,
        valid_from,
        valid_until,
        duration_days,
        evidence,
        frequency,
        source,
        importance,
        created_at,
        updated_at,
        last_recalled_at,
        recall_count,
        retrieved_count,
        superseded_by
      FROM memories;

      DROP TABLE memories;
      ALTER TABLE memories_new RENAME TO memories;

      CREATE INDEX memories_kind_idx ON memories(kind);
      CREATE INDEX memories_subject_idx ON memories(subject);
      CREATE INDEX memories_scope_idx ON memories(scope_kind, scope_ref);
      CREATE INDEX memories_guidance_idx ON memories(guidance);
      CREATE INDEX memories_updated_at_idx ON memories(updated_at DESC);
      CREATE INDEX memories_active_idx ON memories(superseded_by) WHERE superseded_by IS NULL;

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        title,
        body,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT INTO memories_fts(rowid, title, body)
      SELECT rowid, title, body FROM memories;

      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO memories_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;
    `,
  };
}

function memoryColumns(db: Database): Array<{ name: string }> {
  return db.query("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
}

function memoryTableSql(db: Database): string | null {
  const row = db
    .query("SELECT sql FROM sqlite_master WHERE name = 'memories'")
    .get() as { sql: string } | undefined;
  return row?.sql ?? null;
}
