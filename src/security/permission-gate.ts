import {
  normalizePolicyOption,
  parseCapabilityPolicyOptions,
  permissionOptionsForCapability,
  type CapabilityMatchContext,
  type CapabilityMatchKind,
  type CapabilityPolicyOption,
} from "./capability-policy";
import { argsPreview } from "./capability-broker";
import {
  PERMISSION_REQUEST_TIMEOUT_MS,
  type SystemPermissionRequest,
} from "../runtime/runtime-store";
import type { AssistantPermissionMessage, PermissionDecisionStatus } from "../session/types";
import type { ToolContext } from "../agent/tool-context";

const POLL_MS = 200;

export interface RequireToolPermissionInput {
  capability: string;
  toolName: string;
  reason: string;
  command: string;
  cwd?: string;
  targetKind?: string;
  targetValue?: string;
  matchContext?: CapabilityMatchContext;
  args?: unknown;
}

export async function requireToolPermission(
  ctx: ToolContext,
  input: RequireToolPermissionInput,
): Promise<void> {
  const preview = argsPreview(input.args ?? {
    command: input.command,
    cwd: input.cwd,
    targetKind: input.targetKind,
    targetValue: input.targetValue,
  });
  const policy = ctx.runtimeStore?.capabilityPolicyDecision(input.capability, input.matchContext);
  if (policy?.allowed) {
    ctx.capabilities?.audit({
      conversationId: ctx.session.conversationId,
      capability: input.capability,
      toolName: input.toolName,
      allowed: true,
      reason: policy.reason,
      argsPreview: preview,
    });
    return;
  }

  if (!ctx.runtimeStore) throw new Error(`${input.toolName} requires runtime storage for permission prompts`);
  const guardKey = permissionGuardKey(input.capability, input.command, input.cwd ?? "");
  assertPermissionCanPrompt(ctx, guardKey, input.toolName);
  const matchOptions = permissionOptionsForCapability(input.capability, input.matchContext);
  const request = ctx.runtimeStore.createPermissionRequest({
    conversationId: ctx.session.conversationId,
    capability: input.capability,
    toolName: input.toolName,
    command: input.command,
    cwd: input.cwd ?? "",
    reason: input.reason,
    argsPreview: preview,
    targetKind: input.targetKind,
    targetValue: input.targetValue,
    matchOptionsJson: JSON.stringify(matchOptions),
  });
  if (ctx.taskId && ctx.tasks) {
    const task = ctx.tasks.update(ctx.taskId, {
      status: "paused_approval",
      permissionRequestId: request.id,
      reason: `Waiting for approval: ${input.reason}`,
    });
    if (task) ctx.events.emit({ type: "task.status", task });
  }
  ctx.events.emit({
    type: "system.permission_request",
    conversationId: ctx.session.conversationId,
    request,
  });
  rememberPermissionDecision(ctx, guardKey, "pending");
  const decided = await waitForDecision(ctx, request.id);
  rememberPermissionDecision(ctx, guardKey, permissionStatus(decided.status));
  if (ctx.taskId && ctx.tasks) {
    const task = ctx.tasks.update(ctx.taskId, decided.status === "allowed"
      ? { status: "running", reason: "Approval granted" }
      : {
          status: "failed",
          reason: `Approval ${decisionLabel(decided.status)}`,
          errorSummary: `${input.toolName} ${decisionLabel(decided.status)} by user`,
        });
    if (task) ctx.events.emit({ type: "task.status", task });
  }
  await appendPermissionMessage(ctx, decided);
  if (decided.status === "allowed") {
    ctx.capabilities?.audit({
      conversationId: ctx.session.conversationId,
      capability: input.capability,
      toolName: input.toolName,
      allowed: true,
      reason: `permission request ${decided.id} allowed`,
      argsPreview: preview,
    });
    return;
  }
  ctx.capabilities?.audit({
    conversationId: ctx.session.conversationId,
    capability: input.capability,
    toolName: input.toolName,
    allowed: false,
    reason: `permission request ${decided.id} ${decided.status}`,
    argsPreview: preview,
  });
  throw new Error(`${input.toolName} ${decisionLabel(decided.status)} by user`);
}

export function ruleOptionForRequest(
  request: SystemPermissionRequest,
  kind: CapabilityMatchKind,
): CapabilityPolicyOption | null {
  const options = parseMatchOptions(request.matchOptionsJson);
  return options.find((option) => option.kind === kind)
    ?? normalizePolicyOption(request.capability, kind, contextFromRequest(request));
}

export function parseMatchOptions(value: string | null): CapabilityPolicyOption[] {
  return parseCapabilityPolicyOptions(value);
}

function contextFromRequest(request: SystemPermissionRequest): CapabilityMatchContext {
  return {
    command: request.command,
    cwd: request.cwd || undefined,
    hostPath: request.targetKind === "host_path" ? request.targetValue ?? undefined : undefined,
    origin: request.targetKind === "website" ? request.targetValue ?? undefined : undefined,
    url: request.targetKind === "url" ? request.targetValue ?? undefined : undefined,
  };
}

function assertPermissionCanPrompt(ctx: ToolContext, key: string, toolName: string): void {
  const previous = ctx.systemPermissionDecisions?.get(key);
  if (!previous || previous === "allowed") return;
  if (previous === "pending") {
    throw new Error(`${toolName} already has a pending approval for this exact request`);
  }
  throw new Error(
    `${toolName} already ${decisionLabel(previous)} for this exact request in this turn; wait for the user to retry it`,
  );
}

function rememberPermissionDecision(
  ctx: ToolContext,
  key: string,
  status: PermissionDecisionStatus | "pending",
): void {
  ctx.systemPermissionDecisions ??= new Map();
  ctx.systemPermissionDecisions.set(key, status);
}

async function waitForDecision(ctx: ToolContext, requestId: string): Promise<SystemPermissionRequest> {
  const deadline = Date.now() + PERMISSION_REQUEST_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const current = ctx.runtimeStore?.permissionRequest(requestId);
    if (!current) throw new Error(`Permission request not found: ${requestId}`);
    if (current.status !== "pending") return current;
    await Bun.sleep(POLL_MS);
  }
  const timedOut = ctx.runtimeStore?.decidePermissionRequest(
    requestId,
    "timed_out",
    "permission request timed out",
  );
  if (!timedOut) throw new Error(`Permission request not found: ${requestId}`);
  ctx.events.emit({
    type: "system.permission_request",
    conversationId: timedOut.conversationId,
    request: timedOut,
  });
  return timedOut;
}

async function appendPermissionMessage(ctx: ToolContext, request: SystemPermissionRequest): Promise<void> {
  const decidedAt = request.decidedAt ?? new Date().toISOString();
  const message: AssistantPermissionMessage = {
    role: "assistant",
    kind: "permission",
    requestId: request.id,
    toolName: request.toolName,
    status: permissionStatus(request.status),
    command: request.command,
    cwd: request.cwd,
    reason: request.reason,
    decidedAt,
    createdAt: decidedAt,
  };
  ctx.sessions.appendMessages(ctx.session.conversationId, [message]);
  await ctx.flushSessionState?.();
}

function permissionStatus(status: SystemPermissionRequest["status"]): PermissionDecisionStatus {
  return status === "allowed" ? "allowed" : status === "timed_out" ? "timed_out" : "denied";
}

function decisionLabel(status: SystemPermissionRequest["status"] | PermissionDecisionStatus): string {
  return status === "timed_out" ? "timed out" : status;
}

function permissionGuardKey(capability: string, command: string, cwd: string): string {
  return JSON.stringify([capability, cwd, command]);
}
