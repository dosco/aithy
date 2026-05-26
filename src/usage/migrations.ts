import type { SqliteMigration } from "../sqlite/migrations";

export const usageMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        purpose TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thought_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        run_id TEXT,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX llm_usage_occurred_idx ON llm_usage(occurred_at DESC);
      CREATE INDEX llm_usage_purpose_idx ON llm_usage(purpose, occurred_at DESC);
      CREATE INDEX llm_usage_model_idx ON llm_usage(provider, model, occurred_at DESC);
    `,
  },
  {
    version: 2,
    sql: `
      DROP INDEX IF EXISTS llm_usage_purpose_idx;
      DROP INDEX IF EXISTS llm_usage_model_idx;
      DROP INDEX IF EXISTS llm_usage_day_idx;

      CREATE INDEX llm_usage_day_idx
        ON llm_usage(date(occurred_at), provider, model, purpose);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE llm_usage
        ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE llm_usage
        ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE llm_usage
        ADD COLUMN component TEXT NOT NULL DEFAULT 'other';

      ALTER TABLE llm_usage
        ADD COLUMN stage TEXT;

      UPDATE llm_usage SET component = purpose WHERE component = 'other';

      DROP INDEX IF EXISTS llm_usage_day_idx;
      CREATE INDEX llm_usage_day_component_idx
        ON llm_usage(date(occurred_at), provider, model, purpose, component, stage);
    `,
  },
];
