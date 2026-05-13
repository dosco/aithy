import type { Database } from "bun:sqlite";
import type { ToolAuditInput } from "./runtime-store-types";

export function ensureGrant(db: Database, capability: string, reason: string, scope = "global"): void {
  const existing = db.query(`
    SELECT id FROM capability_grants
    WHERE capability = $capability AND scope = $scope
    LIMIT 1
  `).get({ $capability: capability, $scope: scope });
  if (existing) return;
  db.query(`
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

export function grantDecision(db: Database, capability: string, scope = "global"): { allowed: boolean; reason: string } {
  const row = db.query(`
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

export function auditTool(db: Database, input: ToolAuditInput): void {
  db.query(`
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
