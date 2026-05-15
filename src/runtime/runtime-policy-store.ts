import type { Database } from "bun:sqlite";
import {
  matchesCapabilityRule,
  type CapabilityMatchContext,
  type CapabilityMatchKind,
  type CapabilityPolicyDecision,
  type CapabilityPolicyRule,
  type CapabilityRuleSource,
} from "../security/capability-policy";

interface CapabilityPolicyRuleRow {
  id: string;
  capability: string;
  match_kind: CapabilityMatchKind;
  match_value: string | null;
  source: CapabilityRuleSource;
  reason: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface CreateCapabilityPolicyRuleInput {
  capability: string;
  matchKind: CapabilityMatchKind;
  matchValue?: string | null;
  source: CapabilityRuleSource;
  reason?: string | null;
}

export function createCapabilityPolicyRule(
  db: Database,
  input: CreateCapabilityPolicyRuleInput,
): CapabilityPolicyRule {
  const now = new Date().toISOString();
  const existing = db.query(`
    SELECT * FROM capability_policy_rules
    WHERE capability = $capability
      AND match_kind = $matchKind
      AND COALESCE(match_value, '') = COALESCE($matchValue, '')
    LIMIT 1
  `).get({
    $capability: input.capability,
    $matchKind: input.matchKind,
    $matchValue: input.matchValue ?? null,
  }) as CapabilityPolicyRuleRow | undefined;
  if (existing) return capabilityPolicyRuleFromRow(existing);

  const rule: CapabilityPolicyRule = {
    id: crypto.randomUUID(),
    capability: input.capability,
    matchKind: input.matchKind,
    matchValue: input.matchValue ?? null,
    source: input.source,
    reason: input.reason ?? null,
    createdAt: now,
    updatedAt: null,
  };
  db.query(`
    INSERT INTO capability_policy_rules (
      id, capability, match_kind, match_value, source, reason, created_at, updated_at
    ) VALUES (
      $id, $capability, $matchKind, $matchValue, $source, $reason, $createdAt, $updatedAt
    )
  `).run(bindCapabilityPolicyRule(rule));
  return rule;
}

export function capabilityPolicyDecision(
  db: Database,
  capability: string,
  context: CapabilityMatchContext = {},
): CapabilityPolicyDecision {
  if (capability === "sandbox.bash") {
    return { allowed: true, reason: "sandbox.bash is always allowed inside the VM" };
  }
  const rows = db.query(`
    SELECT * FROM capability_policy_rules
    WHERE capability = $capability
    ORDER BY created_at DESC
  `).all({ $capability: capability }) as CapabilityPolicyRuleRow[];
  for (const row of rows) {
    const rule = capabilityPolicyRuleFromRow(row);
    if (matchesCapabilityRule(rule, context)) {
      return { allowed: true, reason: `allowed by ${rule.matchKind} rule`, rule };
    }
  }
  return { allowed: false, reason: "no matching permission rule" };
}

export function listCapabilityPolicyRules(db: Database, search?: string): CapabilityPolicyRule[] {
  const like = search?.trim() ? `%${search.trim().toLowerCase()}%` : null;
  const rows = like
    ? db.query(`
        SELECT * FROM capability_policy_rules
        WHERE lower(capability) LIKE $like
           OR lower(match_kind) LIKE $like
           OR lower(COALESCE(match_value, '')) LIKE $like
           OR lower(COALESCE(reason, '')) LIKE $like
        ORDER BY created_at DESC
      `).all({ $like: like }) as CapabilityPolicyRuleRow[]
    : db.query(`
        SELECT * FROM capability_policy_rules
        ORDER BY created_at DESC
      `).all() as CapabilityPolicyRuleRow[];
  return rows.map(capabilityPolicyRuleFromRow);
}

export function deleteCapabilityPolicyRule(db: Database, id: string): boolean {
  const result = db.query(`DELETE FROM capability_policy_rules WHERE id = $id`).run({ $id: id });
  return result.changes > 0;
}

export function resetCapabilityPolicyRules(db: Database): number {
  const result = db.query(`DELETE FROM capability_policy_rules`).run();
  return result.changes;
}

function capabilityPolicyRuleFromRow(row: CapabilityPolicyRuleRow): CapabilityPolicyRule {
  return {
    id: row.id,
    capability: row.capability,
    matchKind: row.match_kind,
    matchValue: row.match_value,
    source: row.source,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bindCapabilityPolicyRule(rule: CapabilityPolicyRule) {
  return {
    $id: rule.id,
    $capability: rule.capability,
    $matchKind: rule.matchKind,
    $matchValue: rule.matchValue,
    $source: rule.source,
    $reason: rule.reason,
    $createdAt: rule.createdAt,
    $updatedAt: rule.updatedAt,
  };
}
