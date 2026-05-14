import type { Database } from "bun:sqlite";

export type SystemPermissionStatus = "pending" | "allowed" | "denied" | "timed_out";

export interface SystemPermissionRequest {
  id: string;
  conversationId: string;
  capability: string;
  toolName: string;
  command: string;
  cwd: string;
  reason: string;
  argsPreview: string | null;
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
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decisionReason: null,
  };
  db.query(`
    INSERT INTO permission_requests (
      id, conversation_id, capability, tool_name, command, cwd, reason,
      args_preview, status, created_at, decided_at, decision_reason
    ) VALUES (
      $id, $conversationId, $capability, $toolName, $command, $cwd, $reason,
      $argsPreview, $status, $createdAt, $decidedAt, $decisionReason
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
  const rows = db.query(`
    SELECT * FROM permission_requests
    WHERE conversation_id = $conversationId AND status = 'pending'
    ORDER BY created_at ASC
  `).all({ $conversationId: conversationId }) as PermissionRequestRow[];
  return rows.map(requestFromRow);
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

interface PermissionRequestRow {
  id: string;
  conversation_id: string;
  capability: string;
  tool_name: string;
  command: string;
  cwd: string;
  reason: string;
  args_preview: string | null;
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
    $status: request.status,
    $createdAt: request.createdAt,
    $decidedAt: request.decidedAt,
    $decisionReason: request.decisionReason,
  };
}
