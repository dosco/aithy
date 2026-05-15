import path from "node:path";

export type CapabilityMatchKind =
  | "global"
  | "exact_command"
  | "cwd_prefix"
  | "host_path_exact"
  | "host_path_prefix"
  | "website_origin";

export type CapabilityRuleSource = "permission_card" | "settings";

export interface CapabilityPolicyRule {
  id: string;
  capability: string;
  matchKind: CapabilityMatchKind;
  matchValue: string | null;
  source: CapabilityRuleSource;
  reason: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CapabilityMatchContext {
  command?: string;
  cwd?: string;
  hostPath?: string;
  url?: string;
  origin?: string;
}

export interface CapabilityPolicyOption {
  kind: CapabilityMatchKind;
  label: string;
  value: string | null;
}

export interface CapabilityPolicyDecision {
  allowed: boolean;
  reason: string;
  rule?: CapabilityPolicyRule;
}

export function parseCapabilityPolicyOptions(value: string | null): CapabilityPolicyOption[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCapabilityPolicyOption);
  } catch {
    return [];
  }
}

export function permissionOptionsForCapability(
  capability: string,
  context: CapabilityMatchContext = {},
): CapabilityPolicyOption[] {
  if (capability === "system.bash") {
    const options: CapabilityPolicyOption[] = [];
    if (context.command) {
      options.push({ kind: "exact_command", label: "Always allow this exact command", value: context.command });
    }
    if (context.cwd) {
      options.push({ kind: "cwd_prefix", label: "Always allow commands in this folder", value: normalizePathValue(context.cwd) });
    }
    return options;
  }
  if (capability === "sandbox.mount" || capability === "sandbox.getPath") {
    const hostPath = context.hostPath ? normalizePathValue(context.hostPath) : null;
    return hostPath
      ? [
          { kind: "host_path_exact", label: "Always allow this path", value: hostPath },
          { kind: "host_path_prefix", label: "Always allow paths starting here", value: hostPath },
        ]
      : [];
  }
  if (capability === "web.scrape") {
    const origin = normalizeOrigin(context.origin ?? context.url);
    return origin ? [{ kind: "website_origin", label: "Always allow this website", value: origin }] : [];
  }
  if (capability === "web.search") {
    return [{ kind: "global", label: "Always allow web search", value: null }];
  }
  return [{ kind: "global", label: "Always allow this tool", value: null }];
}

export function matchesCapabilityRule(
  rule: CapabilityPolicyRule,
  context: CapabilityMatchContext = {},
): boolean {
  if (rule.matchKind === "global") return true;
  if (rule.matchKind === "exact_command") return rule.matchValue === context.command;
  if (rule.matchKind === "cwd_prefix") return pathStartsWith(context.cwd, rule.matchValue);
  if (rule.matchKind === "host_path_exact") return normalizePathValue(context.hostPath) === rule.matchValue;
  if (rule.matchKind === "host_path_prefix") return pathStartsWith(context.hostPath, rule.matchValue);
  if (rule.matchKind === "website_origin") return normalizeOrigin(context.origin ?? context.url) === rule.matchValue;
  return false;
}

export function normalizePolicyOption(
  capability: string,
  kind: CapabilityMatchKind,
  context: CapabilityMatchContext = {},
): CapabilityPolicyOption | null {
  return permissionOptionsForCapability(capability, context).find((option) => option.kind === kind) ?? null;
}

export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function normalizePathValue(value: string | undefined): string | null {
  if (!value) return null;
  return path.resolve(value);
}

function pathStartsWith(value: string | undefined, prefix: string | null): boolean {
  const normalized = normalizePathValue(value);
  if (!normalized || !prefix) return false;
  const rel = path.relative(prefix, normalized);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function isCapabilityPolicyOption(value: unknown): value is CapabilityPolicyOption {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === "string"
    && typeof record.label === "string"
    && (typeof record.value === "string" || record.value === null);
}
