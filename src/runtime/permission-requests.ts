import type { Database } from "bun:sqlite";

export type SystemPermissionStatus = "pending" | "allowed" | "denied" | "timed_out";
export const PERMISSION_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const PERMISSION_REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface SystemPermissionRequest {
  id: string;
  conversationId: string;
  capability: string;
  toolName: string;
  command: string;
  cwd: string;
  reason: string;
  argsPreview: string | null;
  targetKind: string | null;
  targetValue: string | null;
  matchOptionsJson: string | null;
  status: SystemPermissionStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface CreateSystemPermissionRequestInput {
  conversationId: string;
  capability: string;
  toolName: string;
  command: string;
  cwd: string;
  reason: string;
  argsPreview?: string;
  targetKind?: string | null;
  targetValue?: string | null;
  matchOptionsJson?: string | null;
}

export function createPermissionRequest(
  db: Database,
  input: CreateSystemPermissionRequestInput,
): SystemPermissionRequest {
  const request: SystemPermissionRequest = {
    id: crypto.randomUUID(),
    conversationId: input.conversationId,
    capability: input.capability,
    toolName: input.toolName,
    command: input.command,
    cwd: input.cwd,
    reason: input.reason,
    argsPreview: input.argsPreview ?? null,
    targetKind: input.targetKind ?? null,
    targetValue: input.targetValue ?? null,
    matchOptionsJson: input.matchOptionsJson ?? null,
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decisionReason: null,
  };
  db.query(`
    INSERT INTO permission_requests (
      id, conversation_id, capability, tool_name, command, cwd, reason,
      args_preview, target_kind, target_value, match_options_json, status, created_at, decided_at, decision_reason
    ) VALUES (
      $id, $conversationId, $capability, $toolName, $command, $cwd, $reason,
      $argsPreview, $targetKind, $targetValue, $matchOptionsJson, $status, $createdAt, $decidedAt, $decisionReason
    )
  `).run(bindRequest(request));
  return request;
}

export function permissionRequest(db: Database, id: string): SystemPermissionRequest | null {
  const row = db.query(`
    SELECT * FROM permission_requests WHERE id = $id
  `).get({ $id: id }) as PermissionRequestRow | undefined;
  return row ? requestFromRow(row) : null;
}

export function pendingPermissionRequests(
  db: Database,
  conversationId: string,
): SystemPermissionRequest[] {
  maintainPermissionRequests(db);
  const rows = db.query(`
    SELECT * FROM permission_requests
    WHERE conversation_id = $conversationId AND status = 'pending'
    ORDER BY created_at ASC
  `).all({ $conversationId: conversationId }) as PermissionRequestRow[];
  return rows.map(requestFromRow);
}

export function maintainPermissionRequests(db: Database, now = new Date()): {
  expired: number;
  pruned: number;
} {
  const expired = expireStalePermissionRequests(db, now);
  const pruned = pruneOldPermissionRequests(db, now);
  return { expired, pruned };
}

export function decidePermissionRequest(
  db: Database,
  id: string,
  status: Extract<SystemPermissionStatus, "allowed" | "denied" | "timed_out">,
  decisionReason: string,
): SystemPermissionRequest | null {
  const existing = permissionRequest(db, id);
  if (!existing) return null;
  if (existing.status !== "pending") return existing;
  const decidedAt = new Date().toISOString();
  db.query(`
    UPDATE permission_requests
    SET status = $status,
        decided_at = $decidedAt,
        decision_reason = $decisionReason
    WHERE id = $id AND status = 'pending'
  `).run({
    $id: id,
    $status: status,
    $decidedAt: decidedAt,
    $decisionReason: decisionReason,
  });
  return permissionRequest(db, id);
}

function expireStalePermissionRequests(db: Database, now: Date): number {
  const cutoff = new Date(now.getTime() - PERMISSION_REQUEST_TIMEOUT_MS).toISOString();
  const result = db.query(`
    UPDATE permission_requests
    SET status = 'timed_out',
        decided_at = $now,
        decision_reason = 'permission request expired'
    WHERE status = 'pending' AND created_at <= $cutoff
  `).run({
    $now: now.toISOString(),
    $cutoff: cutoff,
  });
  return result.changes;
}

function pruneOldPermissionRequests(db: Database, now: Date): number {
  const cutoff = new Date(now.getTime() - PERMISSION_REQUEST_RETENTION_MS).toISOString();
  const result = db.query(`
    DELETE FROM permission_requests
    WHERE status != 'pending'
      AND COALESCE(decided_at, created_at) <= $cutoff
  `).run({ $cutoff: cutoff });
  return result.changes;
}

interface PermissionRequestRow {
  id: string;
  conversation_id: string;
  capability: string;
  tool_name: string;
  command: string;
  cwd: string;
  reason: string;
  args_preview: string | null;
  target_kind?: string | null;
  target_value?: string | null;
  match_options_json?: string | null;
  status: SystemPermissionStatus;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
}

function requestFromRow(row: PermissionRequestRow): SystemPermissionRequest {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    capability: row.capability,
    toolName: row.tool_name,
    command: row.command,
    cwd: row.cwd,
    reason: row.reason,
    argsPreview: row.args_preview,
    targetKind: row.target_kind ?? null,
    targetValue: row.target_value ?? null,
    matchOptionsJson: row.match_options_json ?? null,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
  };
}

function bindRequest(request: SystemPermissionRequest) {
  return {
    $id: request.id,
    $conversationId: request.conversationId,
    $capability: request.capability,
    $toolName: request.toolName,
    $command: request.command,
    $cwd: request.cwd,
    $reason: request.reason,
    $argsPreview: request.argsPreview,
    $targetKind: request.targetKind,
    $targetValue: request.targetValue,
    $matchOptionsJson: request.matchOptionsJson,
    $status: request.status,
    $createdAt: request.createdAt,
    $decidedAt: request.decidedAt,
    $decisionReason: request.decisionReason,
  };
}
