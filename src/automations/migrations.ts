import type { SqliteMigration } from "../sqlite/migrations";

export const automationMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE automations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_json TEXT NOT NULL,
        timezone TEXT NOT NULL,
        notification_policy TEXT NOT NULL,
        origin_session_id TEXT NOT NULL,
        created_source TEXT NOT NULL,
        next_run_at TEXT,
        last_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX automations_status_next_idx ON automations(status, next_run_at);
      CREATE INDEX automations_origin_idx ON automations(origin_session_id, updated_at DESC);

      CREATE TABLE automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        run_session_id TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        triggered_at TEXT NOT NULL,
        scheduled_for TEXT NOT NULL,
        result_summary TEXT,
        error_summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX automation_runs_automation_idx ON automation_runs(automation_id, created_at DESC);
      CREATE INDEX automation_runs_task_idx ON automation_runs(task_id);
      CREATE INDEX automation_runs_session_idx ON automation_runs(run_session_id);
      CREATE INDEX automation_runs_status_idx ON automation_runs(status, updated_at DESC);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE automations
        ADD COLUMN attention_type TEXT NOT NULL DEFAULT 'ritual';

      CREATE INDEX automations_attention_type_idx ON automations(attention_type, status);
    `,
  },
];
