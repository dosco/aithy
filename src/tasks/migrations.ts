import type { SqliteMigration } from "../sqlite/migrations";

export const taskMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        conversation_id TEXT,
        related_session_id TEXT,
        runtime_command_id TEXT,
        queue_job_id TEXT,
        memory_run_id TEXT,
        skill_candidate_id TEXT,
        permission_request_id TEXT,
        retry_of_task_id TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        reason TEXT,
        result_summary TEXT,
        error_summary TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX tasks_status_updated_idx ON tasks(status, updated_at DESC);
      CREATE INDEX tasks_conversation_idx ON tasks(conversation_id, updated_at DESC);
      CREATE INDEX tasks_related_session_idx ON tasks(related_session_id, updated_at DESC);
      CREATE INDEX tasks_runtime_command_idx ON tasks(runtime_command_id);
      CREATE INDEX tasks_queue_job_idx ON tasks(queue_job_id);
      CREATE INDEX tasks_memory_run_idx ON tasks(memory_run_id);
      CREATE INDEX tasks_permission_request_idx ON tasks(permission_request_id);

      CREATE TABLE task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX task_events_task_idx ON task_events(task_id, id);
    `,
  },
];

