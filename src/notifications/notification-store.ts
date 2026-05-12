import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { notificationMigrations } from "./migrations";
import type { NotificationCreate, NotificationEntry } from "./types";

interface Row {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  created_at: string;
}

export class SqliteNotificationStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "notifications", notificationMigrations);
  }

  push(input: NotificationCreate): NotificationEntry {
    const now = new Date().toISOString();
    const result = this.db
      .query(
        `INSERT INTO notifications (kind, title, body, link, created_at)
         VALUES ($kind, $title, $body, $link, $now)
         RETURNING *`,
      )
      .get({
        $kind: input.kind,
        $title: input.title,
        $body: input.body ?? null,
        $link: input.link ?? null,
        $now: now,
      }) as Row;
    return rowToEntry(result);
  }

  recent(limit = 50): NotificationEntry[] {
    const rows = this.db
      .query(`SELECT * FROM notifications ORDER BY id DESC LIMIT $limit`)
      .all({ $limit: limit }) as Row[];
    return rows.map(rowToEntry);
  }

  unreadCount(): number {
    const row = this.db
      .query(`SELECT COUNT(*) AS c FROM notifications WHERE read = 0`)
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  }

  markRead(id: number): boolean {
    const res = this.db
      .query(`UPDATE notifications SET read = 1 WHERE id = $id AND read = 0`)
      .run({ $id: id });
    return res.changes > 0;
  }

  markAllRead(): number {
    const res = this.db.query(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
    return res.changes;
  }

  close(): void {
    this.db.close();
  }
}

function rowToEntry(row: Row): NotificationEntry {
  return {
    id: row.id,
    kind: row.kind as NotificationEntry["kind"],
    title: row.title,
    body: row.body,
    link: row.link,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}
