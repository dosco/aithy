import type { Database } from "bun:sqlite";
import type { SessionNameSource } from "./types";

export interface SessionRow {
  id: string;
  name: string;
  name_source: SessionNameSource;
  source: string;
  model: string | null;
  system_prompt: string | null;
  parent_session_id: string | null;
  parent_message_id: number | null;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface MessageRow {
  role: "user" | "assistant";
  message_kind: string | null;
  content: string | null;
  metadata_json: string | null;
  thought: string | null;
  tool_name: string | null;
  tool_args: string | null;
  tool_result: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  thought_tokens: number | null;
  total_tokens: number | null;
  created_at: string;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  content: string;
  allowed_tools: string | null;
  tags: string | null;
  retrieved_count: number;
  updated_at: string;
}

export const sessionMigrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_source TEXT NOT NULL CHECK (name_source IN ('generated', 'manual')),
        source TEXT NOT NULL,
        model TEXT,
        system_prompt TEXT,
        parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thought_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT,
        thought TEXT,
        tool_name TEXT,
        tool_args TEXT,
        tool_result TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        thought_tokens INTEGER,
        total_tokens INTEGER,
        created_at TEXT NOT NULL
      );

      CREATE INDEX messages_session_idx ON messages(session_id, id);

      CREATE TABLE session_mounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        host_path TEXT NOT NULL,
        mount_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, host_path)
      );

      CREATE INDEX session_mounts_session_idx ON session_mounts(session_id);

      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        allowed_tools TEXT,
        tags TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE skills_fts USING fts5(
        name,
        description,
        tags,
        content='skills',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description, tags)
        VALUES (new.rowid, new.name, new.description, COALESCE(new.tags, ''));
      END;

      CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags)
        VALUES ('delete', old.rowid, old.name, old.description, COALESCE(old.tags, ''));
      END;

      CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags)
        VALUES ('delete', old.rowid, old.name, old.description, COALESCE(old.tags, ''));
        INSERT INTO skills_fts(rowid, name, description, tags)
        VALUES (new.rowid, new.name, new.description, COALESCE(new.tags, ''));
      END;
    `,
  },
  {
    version: 2,
    sql: `
      DROP TRIGGER IF EXISTS skills_ai;
      DROP TRIGGER IF EXISTS skills_ad;
      DROP TRIGGER IF EXISTS skills_au;
      DROP TABLE IF EXISTS skills_fts;

      CREATE TABLE skills_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        content TEXT NOT NULL,
        allowed_tools TEXT,
        tags TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT INTO skills_new (id, name, description, content, allowed_tools, tags, updated_at)
      SELECT id, name, description, content, allowed_tools, tags, updated_at FROM skills;

      DROP TABLE skills;
      ALTER TABLE skills_new RENAME TO skills;

      CREATE VIRTUAL TABLE skills_fts USING fts5(
        name,
        description,
        tags,
        content='skills',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT INTO skills_fts(rowid, name, description, tags)
      SELECT rowid, name, description, COALESCE(tags, '') FROM skills;

      CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description, tags)
        VALUES (new.rowid, new.name, new.description, COALESCE(new.tags, ''));
      END;

      CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags)
        VALUES ('delete', old.rowid, old.name, old.description, COALESCE(old.tags, ''));
      END;

      CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags)
        VALUES ('delete', old.rowid, old.name, old.description, COALESCE(old.tags, ''));
        INSERT INTO skills_fts(rowid, name, description, tags)
        VALUES (new.rowid, new.name, new.description, COALESCE(new.tags, ''));
      END;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE sessions ADD COLUMN parent_message_id INTEGER;
    `,
  },
  {
    version: 4,
    precondition: hasSkillTable(),
    sql: `
      ALTER TABLE skills ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 5,
    precondition: hasSkillColumn("used_count"),
    sql: `
      ALTER TABLE skills RENAME COLUMN used_count TO retrieved_count;
    `,
  },
  {
    version: 6,
    precondition: (db: Database) => hasMessageTable(db) && !hasMessageColumn(db, "message_kind"),
    sql: `
      ALTER TABLE messages ADD COLUMN message_kind TEXT;
      ALTER TABLE messages ADD COLUMN metadata_json TEXT;
    `,
  },
];

function hasMessageTable(db: Database): boolean {
  const row = db.query(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'
  `).get();
  return Boolean(row);
}

function hasMessageColumn(db: Database, name: string): boolean {
  const rows = db.query("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  return rows.some((row) => row.name === name);
}

function hasSkillColumn(name: string): (db: Database) => boolean {
  return (db) => {
    const rows = db.query("PRAGMA table_info(skills)").all() as Array<{ name: string }>;
    return rows.some((row) => row.name === name);
  };
}

function hasSkillTable(): (db: Database) => boolean {
  return (db) => {
    const row = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'skills'")
      .get() as { name: string } | undefined;
    return Boolean(row);
  };
}
