import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { memoryMigrations } from "./migrations";

export type MemoryRunStatus = "running" | "completed" | "failed";
export type MemoryRunTrigger = "auto" | "explicit" | "consolidate";

export interface MemoryRun {
  id: string;
  sessionId: string;
  trigger: MemoryRunTrigger;
  status: MemoryRunStatus;
  startedAt: string;
  completedAt: string | null;
  msElapsed: number | null;
  summary: string | null;
  error: string | null;
  childSessionId: string | null;
}

interface MemoryRunRow {
  id: string;
  session_id: string;
  trigger: MemoryRunTrigger;
  status: MemoryRunStatus;
  started_at: string;
  completed_at: string | null;
  ms_elapsed: number | null;
  summary: string | null;
  error: string | null;
  child_session_id: string | null;
}

export class SqliteMemoryRunsStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "memory", memoryMigrations);
  }

  // Idempotent: bunqueue retries reuse the same runId, so we silently no-op on
  // conflict. The original started_at, trigger, and session_id stick.
  recordStart(input: { id: string; sessionId: string; trigger: MemoryRunTrigger }): MemoryRun {
    const startedAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO memory_runs (id, session_id, trigger, status, started_at)
         VALUES ($id, $sessionId, $trigger, 'running', $startedAt)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run({
        $id: input.id,
        $sessionId: input.sessionId,
        $trigger: input.trigger,
        $startedAt: startedAt,
      });
    return this.get(input.id)!;
  }

  recordComplete(id: string, summary: string): MemoryRun {
    const now = new Date();
    const row = this.get(id);
    if (!row) throw new Error(`memory run ${id} not found`);
    const elapsed = Date.parse(now.toISOString()) - Date.parse(row.startedAt);
    this.db
      .query(
        `UPDATE memory_runs
         SET status = 'completed',
             completed_at = $now,
             ms_elapsed = $elapsed,
             summary = $summary
         WHERE id = $id`,
      )
      .run({ $id: id, $now: now.toISOString(), $elapsed: elapsed, $summary: summary });
    return this.get(id)!;
  }

  recordFail(id: string, error: string, childSessionId: string | null): MemoryRun {
    const now = new Date();
    const row = this.get(id);
    if (!row) throw new Error(`memory run ${id} not found`);
    const elapsed = Date.parse(now.toISOString()) - Date.parse(row.startedAt);
    this.db
      .query(
        `UPDATE memory_runs
         SET status = 'failed',
             completed_at = $now,
             ms_elapsed = $elapsed,
             error = $error,
             child_session_id = $child
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $now: now.toISOString(),
        $elapsed: elapsed,
        $error: error,
        $child: childSessionId,
      });
    return this.get(id)!;
  }

  get(id: string): MemoryRun | null {
    const row = this.db
      .query(`SELECT * FROM memory_runs WHERE id = $id`)
      .get({ $id: id }) as MemoryRunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  recent(limit: number): MemoryRun[] {
    const rows = this.db
      .query(
        `SELECT * FROM memory_runs
         ORDER BY started_at DESC
         LIMIT $limit`,
      )
      .all({ $limit: limit }) as MemoryRunRow[];
    return rows.map(rowToRun);
  }

  deleteForSessions(sessionIds: readonly string[]): number {
    if (sessionIds.length === 0) return 0;
    const placeholders = sessionIds.map((_, i) => `$id${i}`).join(", ");
    const params = Object.fromEntries(sessionIds.map((id, i) => [`$id${i}`, id]));
    const result = this.db
      .query(
        `DELETE FROM memory_runs
         WHERE session_id IN (${placeholders})
            OR child_session_id IN (${placeholders})`,
      )
      .run(params as never);
    return result.changes;
  }

  resetAll(): void {
    this.db.query("DELETE FROM memory_runs").run();
  }

  close(): void {
    this.db.close();
  }
}

function rowToRun(row: MemoryRunRow): MemoryRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    msElapsed: row.ms_elapsed,
    summary: row.summary,
    error: row.error,
    childSessionId: row.child_session_id,
  };
}
