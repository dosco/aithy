import type { SqliteMigration } from "../sqlite/migrations";

export const memoryMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'instruction', 'event')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]',
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
        superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL
      );

      CREATE INDEX memories_kind_idx ON memories(kind);
      CREATE INDEX memories_updated_at_idx ON memories(updated_at DESC);
      CREATE INDEX memories_active_idx ON memories(superseded_by) WHERE superseded_by IS NULL;

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        title,
        body,
        labels,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body, labels)
        VALUES (new.rowid, new.title, new.body, new.labels);
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, labels)
        VALUES ('delete', old.rowid, old.title, old.body, old.labels);
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, labels)
        VALUES ('delete', old.rowid, old.title, old.body, old.labels);
        INSERT INTO memories_fts(rowid, title, body, labels)
        VALUES (new.rowid, new.title, new.body, new.labels);
      END;
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE memory_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        ms_elapsed INTEGER,
        summary TEXT,
        error TEXT,
        child_session_id TEXT
      );

      CREATE INDEX memory_runs_session_idx ON memory_runs(session_id, started_at DESC);
      CREATE INDEX memory_runs_recent_idx ON memory_runs(started_at DESC);
    `,
  },
  {
    version: 3,
    // Skipped if sqlite-vec couldn't be loaded — the migration runner will
    // retry on the next launch if the user installs Homebrew sqlite later.
    precondition: (db) => {
      try {
        db.query("SELECT vec_version() AS v").get();
        return true;
      } catch {
        return false;
      }
    },
    sql: `
      CREATE VIRTUAL TABLE memories_vec USING vec0(
        embedding float[384]
      );

      CREATE TABLE memory_embed_meta (
        memory_id TEXT PRIMARY KEY,
        body_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        dim INTEGER NOT NULL,
        embedded_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE INDEX memory_embed_meta_model_idx
        ON memory_embed_meta(model_id, dim);
    `,
  },
  {
    version: 4,
    precondition: (db) => {
      const rows = db.query("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
      return !rows.some((row) => row.name === "retrieved_count");
    },
    sql: `
      ALTER TABLE memories ADD COLUMN retrieved_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 5,
    precondition: (db) => {
      const rows = db.query("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
      return rows.some((row) => row.name === "tags") || !rows.some((row) => row.name === "labels");
    },
    sql: `
      DROP TRIGGER IF EXISTS memories_ai;
      DROP TRIGGER IF EXISTS memories_ad;
      DROP TRIGGER IF EXISTS memories_au;
      DROP TABLE IF EXISTS memories_fts;

      CREATE TABLE memories_new (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'instruction', 'event')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]',
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
        rowid, id, kind, title, body, labels, valid_from, valid_until, duration_days, evidence, frequency, source, importance, created_at,
        updated_at, last_recalled_at, recall_count, retrieved_count, superseded_by
      )
      SELECT
        rowid,
        id,
        CASE WHEN kind = 'episode' THEN 'event' ELSE kind END,
        title,
        body,
        '[' || rtrim(
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' project ') > 0 THEN '"project",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' tooling ') > 0 THEN '"tooling",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' workflow ') > 0 THEN '"workflow",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' health ') > 0 THEN '"health",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' travel ') > 0 THEN '"travel",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' household ') > 0 THEN '"household",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' media ') > 0 THEN '"media",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' art ') > 0 THEN '"art",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' deadline ') > 0 THEN '"deadline",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' recurring ') > 0 THEN '"recurring",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' time_bound ') > 0 THEN '"time_bound",' ELSE '' END) ||
          (CASE WHEN instr(' ' || lower(COALESCE(tags, '')) || ' ', ' verbatim_detail ') > 0 THEN '"verbatim_detail",' ELSE '' END),
          ','
        ) || ']',
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
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
      CREATE INDEX memories_updated_at_idx ON memories(updated_at DESC);
      CREATE INDEX memories_active_idx ON memories(superseded_by) WHERE superseded_by IS NULL;

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        title,
        body,
        labels,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      INSERT INTO memories_fts(rowid, title, body, labels)
      SELECT rowid, title, body, labels FROM memories;

      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body, labels)
        VALUES (new.rowid, new.title, new.body, new.labels);
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, labels)
        VALUES ('delete', old.rowid, old.title, old.body, old.labels);
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, labels)
        VALUES ('delete', old.rowid, old.title, old.body, old.labels);
        INSERT INTO memories_fts(rowid, title, body, labels)
        VALUES (new.rowid, new.title, new.body, new.labels);
      END;
    `,
  },
  {
    version: 6,
    precondition: (db) => {
      const rows = db.query("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
      return !rows.some((row) => row.name === "valid_until");
    },
    sql: `
      ALTER TABLE memories ADD COLUMN valid_from TEXT;
      ALTER TABLE memories ADD COLUMN valid_until TEXT;
      ALTER TABLE memories ADD COLUMN duration_days INTEGER;
      ALTER TABLE memories ADD COLUMN evidence TEXT;
      ALTER TABLE memories ADD COLUMN frequency TEXT;
    `,
  },
];
