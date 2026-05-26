import type { SqliteMigration } from "../sqlite/migrations";

export const trainingDataMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE training_trace_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        run_id TEXT,
        component TEXT NOT NULL,
        stage TEXT,
        name TEXT,
        model TEXT NOT NULL,
        ax_session_id TEXT,
        remote_id TEXT,
        remote_request_id TEXT,
        remote_session_id TEXT,
        provider_metadata_json TEXT,
        model_usage_json TEXT,
        messages_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX training_trace_session_idx
        ON training_trace_entries(session_id, created_at DESC);
      CREATE INDEX training_trace_component_idx
        ON training_trace_entries(component, stage, created_at DESC);
      CREATE INDEX training_trace_model_idx
        ON training_trace_entries(model, created_at DESC);

      CREATE TABLE training_preference_pairs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        chosen_trace_id INTEGER,
        rejected_trace_id INTEGER,
        prompt_messages_json TEXT NOT NULL,
        chosen_messages_json TEXT NOT NULL,
        rejected_messages_json TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX training_preference_session_idx
        ON training_preference_pairs(session_id, created_at DESC);
    `,
  },
];

