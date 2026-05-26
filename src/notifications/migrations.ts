import type { SqliteMigration } from "../sqlite/migrations";

export const notificationMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        link TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX notifications_unread_idx ON notifications(read, id DESC);
      CREATE INDEX notifications_recent_idx ON notifications(id DESC);
    `,
  },
  {
    version: 2,
    precondition: (db) => {
      const rows = db.query("PRAGMA table_info(notifications)").all() as Array<{ name: string }>;
      return !rows.some((row) => row.name === "action_status");
    },
    sql: `
      ALTER TABLE notifications ADD COLUMN conversation_id TEXT;
      ALTER TABLE notifications ADD COLUMN action_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE notifications ADD COLUMN action_expires_at TEXT;
      ALTER TABLE notifications ADD COLUMN resolved_at TEXT;

      CREATE INDEX notifications_action_idx
        ON notifications(action_status, action_expires_at, id DESC);
      CREATE INDEX notifications_conversation_action_idx
        ON notifications(conversation_id, action_status, kind);
    `,
  },
];
