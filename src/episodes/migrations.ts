import type { SqliteMigration } from "../sqlite/migrations";

export const episodeMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE episode_extraction_state (
        key TEXT PRIMARY KEY CHECK (key = 'cursor'),
        last_message_id INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      INSERT INTO episode_extraction_state(key, last_message_id, updated_at)
      VALUES ('cursor', 0, datetime('now'));

      CREATE TABLE agent_episodes (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        task TEXT NOT NULL,
        approach TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('success', 'partial', 'failure')),
        notes TEXT NOT NULL DEFAULT '',
        tool_names TEXT NOT NULL DEFAULT '[]',
        source_session_id TEXT NOT NULL,
        evidence_start_message_id INTEGER NOT NULL,
        evidence_end_message_id INTEGER NOT NULL,
        error TEXT,
        artifact_ids TEXT NOT NULL DEFAULT '[]',
        importance REAL NOT NULL DEFAULT 0.5,
        seen_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_recalled_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0,
        retrieved_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX agent_episodes_updated_idx ON agent_episodes(updated_at DESC);
      CREATE INDEX agent_episodes_session_idx ON agent_episodes(source_session_id, updated_at DESC);

      CREATE VIRTUAL TABLE agent_episodes_fts USING fts5(
        task,
        approach,
        notes,
        tool_names,
        error,
        content='agent_episodes',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER agent_episodes_ai AFTER INSERT ON agent_episodes BEGIN
        INSERT INTO agent_episodes_fts(rowid, task, approach, notes, tool_names, error)
        VALUES (new.rowid, new.task, new.approach, new.notes, new.tool_names, new.error);
      END;

      CREATE TRIGGER agent_episodes_ad AFTER DELETE ON agent_episodes BEGIN
        INSERT INTO agent_episodes_fts(agent_episodes_fts, rowid, task, approach, notes, tool_names, error)
        VALUES ('delete', old.rowid, old.task, old.approach, old.notes, old.tool_names, old.error);
      END;

      CREATE TRIGGER agent_episodes_au AFTER UPDATE ON agent_episodes BEGIN
        INSERT INTO agent_episodes_fts(agent_episodes_fts, rowid, task, approach, notes, tool_names, error)
        VALUES ('delete', old.rowid, old.task, old.approach, old.notes, old.tool_names, old.error);
        INSERT INTO agent_episodes_fts(rowid, task, approach, notes, tool_names, error)
        VALUES (new.rowid, new.task, new.approach, new.notes, new.tool_names, new.error);
      END;
    `,
  },
  {
    version: 2,
    precondition: (db) => {
      try {
        db.query("SELECT vec_version() AS v").get();
        return true;
      } catch {
        return false;
      }
    },
    sql: `
      CREATE VIRTUAL TABLE agent_episodes_vec USING vec0(
        embedding float[384]
      );

      CREATE TABLE agent_episode_embed_meta (
        episode_id TEXT PRIMARY KEY,
        body_hash TEXT NOT NULL,
        model_id TEXT NOT NULL,
        dim INTEGER NOT NULL,
        embedded_at TEXT NOT NULL,
        FOREIGN KEY (episode_id) REFERENCES agent_episodes(id) ON DELETE CASCADE
      );

      CREATE INDEX agent_episode_embed_meta_model_idx
        ON agent_episode_embed_meta(model_id, dim);
    `,
  },
];
