import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations, type SqliteMigration } from "../sqlite/migrations";
import {
  commandError,
  type CommandCompletion,
  type RuntimeLogEventPayload,
  type RuntimeQueueStatus,
  type RuntimeServiceRole,
  type RuntimeServiceState,
  type RuntimeServiceStatus,
} from "./protocol/types";
import type { WebLiveEvent } from "../web/live-events";
import {
  commandRow,
  eventRow,
  hasColumn,
  isCommandCompletion,
  parseJson,
  serviceRow,
  type CommandDbRow,
  type ServiceDbRow,
} from "./runtime-store-rows";
import type {
  RuntimeCommandRow,
  RuntimeCommandStatus,
  RuntimeEventPageInput,
  RuntimeEventRow,
  ToolAuditInput,
} from "./runtime-store-types";

export type {
  RuntimeCommandRow,
  RuntimeCommandStatus,
  RuntimeEventPageInput,
  RuntimeEventRow,
  ToolAuditInput,
} from "./runtime-store-types";

const migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS runtime_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        conversation_id TEXT,
        stream_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS runtime_events_tail_idx ON runtime_events(id);
      CREATE INDEX IF NOT EXISTS runtime_events_expiry_idx ON runtime_events(expires_at);

      CREATE TABLE IF NOT EXISTS runtime_commands (
        id TEXT PRIMARY KEY,
        target_role TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        claimed_at TEXT,
        completed_at TEXT,
        detail_json TEXT
      );
      CREATE INDEX IF NOT EXISTS runtime_commands_pending_idx
        ON runtime_commands(target_role, status, created_at);

      CREATE TABLE IF NOT EXISTS runtime_services (
        role TEXT PRIMARY KEY,
        pid INTEGER,
        status TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        detail_json TEXT
      );

      CREATE TABLE IF NOT EXISTS capability_grants (
        id TEXT PRIMARY KEY,
        capability TEXT NOT NULL,
        scope TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS capability_grants_lookup_idx
        ON capability_grants(capability, scope, created_at);

      CREATE TABLE IF NOT EXISTS tool_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        capability TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        reason TEXT NOT NULL,
        args_preview TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tool_audit_log_created_idx ON tool_audit_log(created_at);
    `,
  },
  {
    version: 2,
    precondition: (db) => !hasColumn(db, "runtime_commands", "claimed_at"),
    sql: `
      ALTER TABLE runtime_commands ADD COLUMN claimed_at TEXT;
      ALTER TABLE runtime_commands ADD COLUMN completed_at TEXT;
      ALTER TABLE runtime_commands ADD COLUMN detail_json TEXT;
    `,
  },
];

const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class RuntimeStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "runtime", migrations);
  }

  appendEvent(event: WebLiveEvent, expiresAt?: string | null): number {
    const row = this.db.query(`
      INSERT INTO runtime_events (kind, conversation_id, stream_id, payload_json, created_at, expires_at)
      VALUES ($kind, $conversationId, $streamId, $payload, $createdAt, $expiresAt)
      RETURNING id
    `).get({
      $kind: event.type,
      $conversationId: "conversationId" in event ? event.conversationId : null,
      $streamId: event.streamId ?? null,
      $payload: JSON.stringify(event),
      $createdAt: event.createdAt,
      $expiresAt: expiresAt ?? null,
    }) as { id: number };
    return row.id;
  }

  appendLog(input: RuntimeLogEventPayload, expiresAt?: string | null): number {
    return this.appendEvent(
      {
        type: "log",
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...input,
      },
      expiresAt ?? new Date(Date.now() + LOG_RETENTION_MS).toISOString(),
    );
  }

  appendQueueStatus(queue: RuntimeQueueStatus): number {
    return this.appendEvent({
      type: "queue-status",
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      queue,
    });
  }

  latestEventId(): number {
    const row = this.db.query(`SELECT COALESCE(MAX(id), 0) AS id FROM runtime_events`).get() as { id: number };
    return row.id;
  }

  eventsAfter(id: number, limit = 100): RuntimeEventRow[] {
    const rows = this.db.query(`
      SELECT id, kind, conversation_id, stream_id, payload_json, created_at
      FROM runtime_events
      WHERE id > $id AND (expires_at IS NULL OR expires_at > $now)
      ORDER BY id ASC
      LIMIT $limit
    `).all({ $id: id, $now: new Date().toISOString(), $limit: limit }) as Array<{
      id: number;
      kind: string;
      conversation_id: string | null;
      stream_id: string | null;
      payload_json: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      conversationId: row.conversation_id,
      streamId: row.stream_id,
      payload: JSON.parse(row.payload_json) as WebLiveEvent,
      createdAt: row.created_at,
    }));
  }

  recentEvents(input: RuntimeEventPageInput = {}): RuntimeEventRow[] {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const filters: string[] = ["(expires_at IS NULL OR expires_at > $now)"];
    const params: Record<string, unknown> = {
      $now: new Date().toISOString(),
      $limit: limit,
      $before: input.beforeId ?? Number.MAX_SAFE_INTEGER,
    };
    filters.push("id < $before");
    if (input.kinds?.length) {
      filters.push(`kind IN (${input.kinds.map((_, i) => `$kind${i}`).join(", ")})`);
      input.kinds.forEach((kind, i) => {
        params[`$kind${i}`] = kind;
      });
    }
    if (input.role) {
      filters.push("json_extract(payload_json, '$.role') = $role");
      params.$role = input.role;
    }
    if (input.level) {
      filters.push("json_extract(payload_json, '$.level') = $level");
      params.$level = input.level;
    }
    if (input.search?.trim()) {
      filters.push("payload_json LIKE $search");
      params.$search = `%${input.search.trim()}%`;
    }
    const rows = this.db.query(`
      SELECT id, kind, conversation_id, stream_id, payload_json, created_at
      FROM runtime_events
      WHERE ${filters.join(" AND ")}
      ORDER BY id DESC
      LIMIT $limit
    `).all(params as never) as Array<{
      id: number;
      kind: string;
      conversation_id: string | null;
      stream_id: string | null;
      payload_json: string;
      created_at: string;
    }>;
    return rows.map(eventRow);
  }

  enqueueCommand(targetRole: RuntimeServiceRole, kind: string, payload: unknown = {}): string {
    const id = crypto.randomUUID();
    this.db.query(`
      INSERT INTO runtime_commands (id, target_role, kind, payload_json, status, created_at)
      VALUES ($id, $targetRole, $kind, $payload, 'pending', $createdAt)
    `).run({
      $id: id,
      $targetRole: targetRole,
      $kind: kind,
      $payload: JSON.stringify(payload),
      $createdAt: new Date().toISOString(),
    });
    return id;
  }

  commandById(id: string): RuntimeCommandRow | null {
    const row = this.db.query(`
      SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
      FROM runtime_commands
      WHERE id = $id
    `).get({ $id: id }) as CommandDbRow | undefined;
    return row ? commandRow(row) : null;
  }

  recentCommands(limit = 100): RuntimeCommandRow[] {
    const rows = this.db.query(`
      SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
      FROM runtime_commands
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $limit: Math.max(1, Math.min(limit, 500)) }) as CommandDbRow[];
    return rows.map(commandRow);
  }

  unfinishedCommands(): RuntimeCommandRow[] {
    const rows = this.db.query(`
      SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
      FROM runtime_commands
      WHERE status IN ('pending', 'claimed')
      ORDER BY created_at ASC
    `).all() as CommandDbRow[];
    return rows.map(commandRow);
  }

  claimCommand(id: string): RuntimeCommandRow | null {
    const now = new Date().toISOString();
    const result = this.db.query(`
      UPDATE runtime_commands
      SET status = 'claimed', claimed_at = $now
      WHERE id = $id AND status = 'pending'
    `).run({ $id: id, $now: now });
    if (result.changes === 0) return this.commandById(id);
    return this.commandById(id);
  }

  claimPendingCommands(targetRole: RuntimeServiceRole, limit = 20): RuntimeCommandRow[] {
    const rows = this.db.query(`
      SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
      FROM runtime_commands
      WHERE target_role = $targetRole AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT $limit
    `).all({ $targetRole: targetRole, $limit: limit }) as Array<{
      id: string;
      target_role: RuntimeServiceRole;
      kind: string;
      payload_json: string;
      status: RuntimeCommandStatus;
      created_at: string;
      claimed_at: string | null;
      completed_at: string | null;
      detail_json: string | null;
    }>;
    const now = new Date().toISOString();
    const update = this.db.query(`
      UPDATE runtime_commands
      SET status = 'claimed', claimed_at = $now
      WHERE id = $id AND status = 'pending'
    `);
    const claimed: RuntimeCommandRow[] = [];
    for (const row of rows) {
      const result = update.run({ $id: row.id, $now: now });
      if (result.changes === 0) continue;
      claimed.push({
        id: row.id,
        targetRole: row.target_role,
        kind: row.kind,
        payload: JSON.parse(row.payload_json),
        status: "claimed",
        createdAt: row.created_at,
        claimedAt: now,
        completedAt: row.completed_at,
        detail: parseJson(row.detail_json),
      });
    }
    return claimed;
  }

  completeCommand(id: string, status: Extract<RuntimeCommandStatus, "completed" | "failed">, detail?: unknown): void {
    const normalized: CommandCompletion =
      isCommandCompletion(detail)
        ? detail
        : status === "completed"
          ? { ok: true, result: detail ?? null }
          : { ok: false, error: commandError(detail ?? "Command failed") };
    this.db.query(`
      UPDATE runtime_commands
      SET status = $status, completed_at = $completedAt, detail_json = $detail
      WHERE id = $id
    `).run({
      $id: id,
      $status: status,
      $completedAt: new Date().toISOString(),
      $detail: JSON.stringify(normalized),
    });
  }

  async waitForCommand(id: string, input: { timeoutMs?: number; pollMs?: number } = {}): Promise<CommandCompletion> {
    const timeoutMs = input.timeoutMs ?? 60_000;
    const pollMs = input.pollMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const row = this.commandById(id);
      if (!row) return { ok: false, error: `Runtime command not found: ${id}` };
      if (row.status === "completed" || row.status === "failed") {
        return isCommandCompletion(row.detail)
          ? row.detail
          : row.status === "completed"
            ? { ok: true, result: row.detail ?? null }
            : { ok: false, error: commandError(row.detail ?? "Command failed") };
      }
      await Bun.sleep(pollMs);
    }
    return { ok: false, error: `Runtime command timed out after ${timeoutMs}ms: ${id}` };
  }

  heartbeat(role: RuntimeServiceRole, status: RuntimeServiceState | string, detail?: unknown): void {
    const previous = this.service(role);
    const detailJson = detail === undefined ? null : JSON.stringify(detail);
    const changed = !previous
      || previous.state !== status
      || JSON.stringify(previous.detail ?? null) !== (detailJson ?? "null");
    const lastSeenAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO runtime_services (role, pid, status, last_seen_at, detail_json)
      VALUES ($role, $pid, $status, $lastSeenAt, $detail)
      ON CONFLICT(role) DO UPDATE SET
        pid = excluded.pid,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        detail_json = excluded.detail_json
    `).run({
      $role: role,
      $pid: process.pid,
      $status: status,
      $lastSeenAt: lastSeenAt,
      $detail: detailJson,
    });
    if (changed) {
      this.appendEvent({
        type: "service-status",
        id: crypto.randomUUID(),
        createdAt: lastSeenAt,
        role,
        state: status as RuntimeServiceState,
        pid: process.pid,
        detail: detail ?? null,
        lastSeenAt,
      });
    }
  }

  service(role: RuntimeServiceRole): RuntimeServiceStatus | null {
    const row = this.db.query(`
      SELECT role, pid, status, last_seen_at, detail_json
      FROM runtime_services
      WHERE role = $role
    `).get({ $role: role }) as ServiceDbRow | undefined;
    return row ? serviceRow(row) : null;
  }

  services(): RuntimeServiceStatus[] {
    const rows = this.db.query(`
      SELECT role, pid, status, last_seen_at, detail_json
      FROM runtime_services
      ORDER BY role ASC
    `).all() as ServiceDbRow[];
    return rows.map(serviceRow);
  }

  ensureGrant(capability: string, reason: string, scope = "global"): void {
    const existing = this.db.query(`
      SELECT id FROM capability_grants
      WHERE capability = $capability AND scope = $scope
      LIMIT 1
    `).get({ $capability: capability, $scope: scope });
    if (existing) return;
    this.db.query(`
      INSERT INTO capability_grants (id, capability, scope, decision, reason, created_at)
      VALUES ($id, $capability, $scope, 'allow', $reason, $createdAt)
    `).run({
      $id: crypto.randomUUID(),
      $capability: capability,
      $scope: scope,
      $reason: reason,
      $createdAt: new Date().toISOString(),
    });
  }

  grantDecision(capability: string, scope = "global"): { allowed: boolean; reason: string } {
    const row = this.db.query(`
      SELECT decision, reason
      FROM capability_grants
      WHERE capability = $capability
        AND scope = $scope
        AND (expires_at IS NULL OR expires_at > $now)
      ORDER BY created_at DESC
      LIMIT 1
    `).get({
      $capability: capability,
      $scope: scope,
      $now: new Date().toISOString(),
    }) as { decision: string; reason: string | null } | undefined;
    return {
      allowed: row?.decision === "allow",
      reason: row?.reason ?? "no capability grant",
    };
  }

  auditTool(input: ToolAuditInput): void {
    this.db.query(`
      INSERT INTO tool_audit_log (
        conversation_id, capability, tool_name, allowed, reason, args_preview, created_at
      ) VALUES (
        $conversationId, $capability, $toolName, $allowed, $reason, $argsPreview, $createdAt
      )
    `).run({
      $conversationId: input.conversationId ?? null,
      $capability: input.capability,
      $toolName: input.toolName,
      $allowed: input.allowed ? 1 : 0,
      $reason: input.reason,
      $argsPreview: input.argsPreview ?? null,
      $createdAt: new Date().toISOString(),
    });
  }

  close(): void {
    this.db.close();
  }
}
