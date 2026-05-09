import type { SqliteMigration } from "../sqlite/migrations";

export const memoryMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'episode', 'instruction')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT,
        source TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_recalled_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT REFERENCES memories(id) ON DELETE SET NULL
      );

      CREATE INDEX memories_kind_idx ON memories(kind);
      CREATE INDEX memories_updated_at_idx ON memories(updated_at DESC);
      CREATE INDEX memories_active_idx ON memories(superseded_by) WHERE superseded_by IS NULL;

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        title,
        body,
        tags,
        content='memories',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, COALESCE(new.tags, ''));
      END;

      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, COALESCE(old.tags, ''));
      END;

      CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, title, body, tags)
        VALUES ('delete', old.rowid, old.title, old.body, COALESCE(old.tags, ''));
        INSERT INTO memories_fts(rowid, title, body, tags)
        VALUES (new.rowid, new.title, new.body, COALESCE(new.tags, ''));
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
];
