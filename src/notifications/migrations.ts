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
];
