import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { notificationMigrations } from "./migrations";
import type { NotificationActionStatus, NotificationCreate, NotificationEntry, NotificationKind } from "./types";

interface Row {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  conversation_id: string | null;
  action_status: NotificationActionStatus;
  action_expires_at: string | null;
  resolved_at: string | null;
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
    const actionStatus = input.actionStatus ?? "none";
    const result = this.db
      .query(
        `INSERT INTO notifications (
          kind, title, body, link, conversation_id, action_status,
          action_expires_at, created_at
        )
         VALUES (
          $kind, $title, $body, $link, $conversationId, $actionStatus,
          $actionExpiresAt, $now
        )
         RETURNING *`,
      )
      .get({
        $kind: input.kind,
        $title: input.title,
        $body: input.body ?? null,
        $link: input.link ?? null,
        $conversationId: input.conversationId ?? null,
        $actionStatus: actionStatus,
        $actionExpiresAt: actionStatus === "pending" ? input.actionExpiresAt ?? null : null,
        $now: now,
      }) as Row;
    return rowToEntry(result);
  }

  recent(limit = 50): NotificationEntry[] {
    this.expireActions();
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

  activeActions(limit = 50): NotificationEntry[] {
    this.expireActions();
    const rows = this.db.query(`
      SELECT * FROM notifications
      WHERE action_status = 'pending'
      ORDER BY id DESC
      LIMIT $limit
    `).all({ $limit: limit }) as Row[];
    return rows.map(rowToEntry);
  }

  resolvePendingActions(input: {
    conversationId: string;
    kinds?: readonly NotificationKind[];
  }): number {
    if (input.kinds?.length === 0) return 0;
    const now = new Date().toISOString();
    const kindClause = input.kinds?.length
      ? `AND kind IN (${input.kinds.map((_, index) => `$kind${index}`).join(", ")})`
      : "";
    const params: Record<string, unknown> = {
      $conversationId: input.conversationId,
      $now: now,
    };
    input.kinds?.forEach((kind, index) => {
      params[`$kind${index}`] = kind;
    });
    const res = this.db.query(`
      UPDATE notifications
      SET action_status = 'resolved',
          resolved_at = $now
      WHERE conversation_id = $conversationId
        AND action_status = 'pending'
        ${kindClause}
    `).run(params as never);
    return res.changes;
  }

  expireActions(now = new Date()): number {
    const timestamp = now.toISOString();
    const res = this.db.query(`
      UPDATE notifications
      SET action_status = 'expired',
          resolved_at = $now
      WHERE action_status = 'pending'
        AND action_expires_at IS NOT NULL
        AND action_expires_at <= $now
    `).run({ $now: timestamp });
    return res.changes;
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
    conversationId: row.conversation_id ?? null,
    actionStatus: row.action_status ?? "none",
    actionExpiresAt: row.action_expires_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
  };
}
