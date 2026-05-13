import type { Database } from "bun:sqlite";
import { commandError, type CommandCompletion, type RuntimeServiceRole } from "./protocol/types";
import { commandRow, isCommandCompletion, parseJson, type CommandDbRow } from "./runtime-store-rows";
import type { RuntimeCommandRow, RuntimeCommandStatus } from "./runtime-store-types";

export function enqueueCommand(db: Database, targetRole: RuntimeServiceRole, kind: string, payload: unknown = {}): string {
  const id = crypto.randomUUID();
  db.query(`
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

export function commandById(db: Database, id: string): RuntimeCommandRow | null {
  const row = db.query(`
    SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
    FROM runtime_commands
    WHERE id = $id
  `).get({ $id: id }) as CommandDbRow | undefined;
  return row ? commandRow(row) : null;
}

export function recentCommands(db: Database, limit = 100): RuntimeCommandRow[] {
  const rows = db.query(`
    SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
    FROM runtime_commands
    ORDER BY created_at DESC
    LIMIT $limit
  `).all({ $limit: Math.max(1, Math.min(limit, 500)) }) as CommandDbRow[];
  return rows.map(commandRow);
}

export function unfinishedCommands(db: Database): RuntimeCommandRow[] {
  const rows = db.query(`
    SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
    FROM runtime_commands
    WHERE status IN ('pending', 'claimed')
    ORDER BY created_at ASC
  `).all() as CommandDbRow[];
  return rows.map(commandRow);
}

export function claimCommand(db: Database, id: string): RuntimeCommandRow | null {
  const now = new Date().toISOString();
  db.query(`
    UPDATE runtime_commands
    SET status = 'claimed', claimed_at = $now
    WHERE id = $id AND status = 'pending'
  `).run({ $id: id, $now: now });
  return commandById(db, id);
}

export function claimPendingCommands(
  db: Database,
  targetRole: RuntimeServiceRole,
  limit = 20,
): RuntimeCommandRow[] {
  const rows = db.query(`
    SELECT id, target_role, kind, payload_json, status, created_at, claimed_at, completed_at, detail_json
    FROM runtime_commands
    WHERE target_role = $targetRole AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT $limit
  `).all({ $targetRole: targetRole, $limit: limit }) as CommandDbRow[];
  const now = new Date().toISOString();
  const update = db.query(`
    UPDATE runtime_commands
    SET status = 'claimed', claimed_at = $now
    WHERE id = $id AND status = 'pending'
  `);
  const claimed: RuntimeCommandRow[] = [];
  for (const row of rows) {
    if (update.run({ $id: row.id, $now: now }).changes === 0) continue;
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

export function completeCommand(
  db: Database,
  id: string,
  status: Extract<RuntimeCommandStatus, "completed" | "failed">,
  detail?: unknown,
): void {
  const normalized = normalizeCompletion(status, detail);
  db.query(`
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

export function completionFromRow(row: RuntimeCommandRow): CommandCompletion {
  if (isCommandCompletion(row.detail)) return row.detail;
  return row.status === "completed"
    ? { ok: true, result: row.detail ?? null }
    : { ok: false, error: commandError(row.detail ?? "Command failed") };
}

function normalizeCompletion(
  status: Extract<RuntimeCommandStatus, "completed" | "failed">,
  detail?: unknown,
): CommandCompletion {
  if (isCommandCompletion(detail)) return detail;
  return status === "completed"
    ? { ok: true, result: detail ?? null }
    : { ok: false, error: commandError(detail ?? "Command failed") };
}
