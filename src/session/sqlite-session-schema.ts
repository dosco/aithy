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
  when_to_use: string | null;
  allowed_tools: string | null;
  required_sandbox_capabilities: string | null;
  tags: string | null;
  retrieved_count: number;
  used_count: number;
  disable_model_invocation: number;
  user_invocable: number;
  source_kind: "user" | "builtin";
  source_id: string | null;
  source_version: string | null;
  source_hash: string | null;
  disabled_at: string | null;
  duplicated_from_source_id: string | null;
  last_retrieved_at: string | null;
  last_used_at: string | null;
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
  {
    version: 7,
    precondition: hasSkillTable(),
    sql: `
      ALTER TABLE skills ADD COLUMN when_to_use TEXT;
      ALTER TABLE skills ADD COLUMN disable_model_invocation INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE skills ADD COLUMN user_invocable INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE skills ADD COLUMN used_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE skills ADD COLUMN last_retrieved_at TEXT;
      ALTER TABLE skills ADD COLUMN last_used_at TEXT;

      CREATE TABLE skill_files (
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (skill_id, path)
      );

      CREATE TABLE skill_links (
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        target_skill_id TEXT NOT NULL,
        PRIMARY KEY (skill_id, target_skill_id)
      );

      CREATE TABLE skill_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL CHECK (event_type IN ('loaded', 'used')),
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        session_id TEXT,
        task_id TEXT,
        stage TEXT,
        reason TEXT,
        query TEXT,
        match_kind TEXT,
        queries_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX skill_events_skill_idx ON skill_events(skill_id, created_at DESC);
      CREATE INDEX skill_events_session_idx ON skill_events(session_id, created_at DESC);

      DROP TRIGGER IF EXISTS skills_ai;
      DROP TRIGGER IF EXISTS skills_ad;
      DROP TRIGGER IF EXISTS skills_au;
      DROP TABLE IF EXISTS skills_fts;

      CREATE VIRTUAL TABLE skills_fts USING fts5(
        name,
        description,
        when_to_use,
        tags,
        content='skills',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT INTO skills_fts(rowid, name, description, when_to_use, tags)
      SELECT rowid, name, description, COALESCE(when_to_use, ''), COALESCE(tags, '') FROM skills;

      CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description, when_to_use, tags)
        VALUES (new.rowid, new.name, new.description, COALESCE(new.when_to_use, ''), COALESCE(new.tags, ''));
      END;

      CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, when_to_use, tags)
        VALUES ('delete', old.rowid, old.name, old.description, COALESCE(old.when_to_use, ''), COALESCE(old.tags, ''));
      END;

      CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, when_to_use, tags)
        VALUES ('delete', old.rowid, old.name, old.description, COALESCE(old.when_to_use, ''), COALESCE(old.tags, ''));
        INSERT INTO skills_fts(rowid, name, description, when_to_use, tags)
        VALUES (new.rowid, new.name, new.description, COALESCE(new.when_to_use, ''), COALESCE(new.tags, ''));
      END;
    `,
  },
  {
    version: 8,
    precondition: (db: Database) => {
      try {
        db.query("SELECT vec_version() AS v").get();
        return true;
      } catch {
        return false;
      }
    },
    sql: `
      CREATE TABLE skill_embedding_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        chunk_key TEXT NOT NULL,
        text TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        dim INTEGER NOT NULL,
        embedded_at TEXT NOT NULL,
        UNIQUE(skill_id, chunk_key)
      );

      CREATE INDEX skill_embedding_chunks_skill_idx
        ON skill_embedding_chunks(skill_id);
      CREATE INDEX skill_embedding_chunks_model_idx
        ON skill_embedding_chunks(model_id, dim);

      CREATE VIRTUAL TABLE skills_vec USING vec0(
        embedding float[1024]
      );
    `,
  },
  {
    version: 9,
    precondition: (db: Database) => hasSkillTable()(db) && !hasSkillColumn("source_kind")(db),
    sql: `
      ALTER TABLE skills ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'user' CHECK (source_kind IN ('user', 'builtin'));
      ALTER TABLE skills ADD COLUMN source_id TEXT;
      ALTER TABLE skills ADD COLUMN source_version TEXT;
      ALTER TABLE skills ADD COLUMN source_hash TEXT;
      ALTER TABLE skills ADD COLUMN disabled_at TEXT;
      ALTER TABLE skills ADD COLUMN duplicated_from_source_id TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS skills_builtin_source_idx
        ON skills(source_id)
        WHERE source_kind = 'builtin' AND source_id IS NOT NULL;
    `,
  },
  {
    version: 10,
    precondition: (db: Database) => hasMessageTable(db) && (!tableExists(db, "messages_fts") || !tableExists(db, "skill_search_chunks")),
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        session_id UNINDEXED,
        role UNINDEXED,
        content,
        tool_name,
        tool_args,
        tool_result,
        metadata_json,
        created_at UNINDEXED,
        content='messages',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT INTO messages_fts(rowid, session_id, role, content, tool_name, tool_args, tool_result, metadata_json, created_at)
      SELECT id, session_id, role, COALESCE(content, ''), COALESCE(tool_name, ''),
             substr(COALESCE(tool_args, ''), 1, 4000),
             substr(COALESCE(tool_result, ''), 1, 4000),
             substr(COALESCE(metadata_json, ''), 1, 4000),
             created_at
      FROM messages
      WHERE NOT EXISTS (SELECT 1 FROM messages_fts LIMIT 1);

      CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, session_id, role, content, tool_name, tool_args, tool_result, metadata_json, created_at)
        VALUES (new.id, new.session_id, new.role, COALESCE(new.content, ''), COALESCE(new.tool_name, ''),
                substr(COALESCE(new.tool_args, ''), 1, 4000),
                substr(COALESCE(new.tool_result, ''), 1, 4000),
                substr(COALESCE(new.metadata_json, ''), 1, 4000),
                new.created_at);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, session_id, role, content, tool_name, tool_args, tool_result, metadata_json, created_at)
        VALUES ('delete', old.id, old.session_id, old.role, COALESCE(old.content, ''), COALESCE(old.tool_name, ''),
                substr(COALESCE(old.tool_args, ''), 1, 4000),
                substr(COALESCE(old.tool_result, ''), 1, 4000),
                substr(COALESCE(old.metadata_json, ''), 1, 4000),
                old.created_at);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, session_id, role, content, tool_name, tool_args, tool_result, metadata_json, created_at)
        VALUES ('delete', old.id, old.session_id, old.role, COALESCE(old.content, ''), COALESCE(old.tool_name, ''),
                substr(COALESCE(old.tool_args, ''), 1, 4000),
                substr(COALESCE(old.tool_result, ''), 1, 4000),
                substr(COALESCE(old.metadata_json, ''), 1, 4000),
                old.created_at);
        INSERT INTO messages_fts(rowid, session_id, role, content, tool_name, tool_args, tool_result, metadata_json, created_at)
        VALUES (new.id, new.session_id, new.role, COALESCE(new.content, ''), COALESCE(new.tool_name, ''),
                substr(COALESCE(new.tool_args, ''), 1, 4000),
                substr(COALESCE(new.tool_result, ''), 1, 4000),
                substr(COALESCE(new.metadata_json, ''), 1, 4000),
                new.created_at);
      END;

      CREATE TABLE IF NOT EXISTS skill_search_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        chunk_key TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(skill_id, chunk_key)
      );

      CREATE INDEX IF NOT EXISTS skill_search_chunks_skill_idx ON skill_search_chunks(skill_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS skill_search_chunks_fts USING fts5(
        text,
        content='skill_search_chunks',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS skill_search_chunks_ai AFTER INSERT ON skill_search_chunks BEGIN
        INSERT INTO skill_search_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS skill_search_chunks_ad AFTER DELETE ON skill_search_chunks BEGIN
        INSERT INTO skill_search_chunks_fts(skill_search_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS skill_search_chunks_au AFTER UPDATE ON skill_search_chunks BEGIN
        INSERT INTO skill_search_chunks_fts(skill_search_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO skill_search_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `,
  },
  {
    version: 11,
    precondition: (db: Database) => hasSkillTable()(db) && !hasSkillColumn("required_sandbox_capabilities")(db),
    sql: `
      ALTER TABLE skills ADD COLUMN required_sandbox_capabilities TEXT;
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

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = $name")
    .get({ $name: name }) as { name: string } | undefined;
  return Boolean(row);
}
