import { f, fn } from "@ax-llm/ax";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  MAX_TOOL_OUTPUT_CHARS,
} from "../../config/limits";
import { argsPreview } from "../../security/capability-broker";
import {
  PERMISSION_REQUEST_TIMEOUT_MS,
  type SystemPermissionRequest,
} from "../../runtime/runtime-store";
import { runHostBash } from "../../system/host-bash";
import type { AssistantPermissionMessage, PermissionDecisionStatus } from "../../session/types";
import type { ToolContext } from "../tool-context";

const SYSTEM_BASH_CAPABILITY = "system.bash";
const POLL_MS = 200;

export function createSystemTools(ctx: ToolContext) {
  return [createBashTool(ctx)];
}

function createBashTool(ctx: ToolContext) {
  return fn("bash")
    .namespace("system")
    .description([
      "Execute a shell command on the user's base computer, outside the VM/sandbox.",
      "Use only when sandbox.bash cannot satisfy the request because host-only state is required.",
      "Requires a per-command user approval; include a concise reason explaining why sandbox.bash is insufficient.",
      "Default cwd is the host directory backing /workspace.",
    ].join(" "))
    .arg("command", f.string("Bash command to run on the base computer"))
    .arg("reason", f.string("Why sandbox.bash cannot do this"))
    .arg("cwd", f.string("Absolute host working directory").optional())
    .arg("timeoutMs", f.number("Timeout in milliseconds").optional())
    .arg("maxOutputChars", f.number("Maximum stdout/stderr characters").optional())
    .returnsField("exitCode", f.number("Command exit code"))
    .returnsField("stdout", f.string("Standard output, truncated when large"))
    .returnsField("stderr", f.string("Standard error, truncated when large"))
    .returnsField("timedOut", f.boolean("Whether the host timeout killed the process"))
    .handler(async (request) => {
      const args = normalizeSystemBashArgs(ctx, request);
      const preview = argsPreview(args);
      const approved = await requireUserApproval(ctx, args, preview);
      ctx.capabilities?.audit({
        conversationId: ctx.session.conversationId,
        capability: SYSTEM_BASH_CAPABILITY,
        toolName: SYSTEM_BASH_CAPABILITY,
        allowed: true,
        reason: `permission request ${approved.id} allowed`,
        argsPreview: preview,
      });
      ctx.events.emit({
        type: "system.exec",
        conversationId: ctx.session.conversationId,
        command: args.command,
      });
      return runHostBash(args);
    })
    .build();
}

async function requireUserApproval(
  ctx: ToolContext,
  args: ReturnType<typeof normalizeSystemBashArgs>,
  preview: string,
): Promise<SystemPermissionRequest> {
  if (!ctx.runtimeStore) throw new Error("system.bash is unavailable without runtime storage");
  const guardKey = permissionGuardKey(args.command, args.cwd);
  assertPermissionCanPrompt(ctx, guardKey);
  const request = ctx.runtimeStore.createPermissionRequest({
    conversationId: ctx.session.conversationId,
    capability: SYSTEM_BASH_CAPABILITY,
    toolName: SYSTEM_BASH_CAPABILITY,
    command: args.command,
    cwd: args.cwd,
    reason: args.reason,
    argsPreview: preview,
  });
  ctx.events.emit({
    type: "system.permission_request",
    conversationId: ctx.session.conversationId,
    request,
  });
  rememberPermissionDecision(ctx, guardKey, "pending");
  const decided = await waitForDecision(ctx, request.id);
  rememberPermissionDecision(ctx, guardKey, permissionStatus(decided.status));
  await appendPermissionMessage(ctx, decided);
  if (decided.status === "allowed") return decided;
  ctx.capabilities?.audit({
    conversationId: ctx.session.conversationId,
    capability: SYSTEM_BASH_CAPABILITY,
    toolName: SYSTEM_BASH_CAPABILITY,
    allowed: false,
    reason: `permission request ${decided.id} ${decided.status}`,
    argsPreview: preview,
  });
  throw new Error(`system.bash ${decisionLabel(decided.status)} by user`);
}

function assertPermissionCanPrompt(ctx: ToolContext, key: string): void {
  const previous = ctx.systemPermissionDecisions?.get(key);
  if (!previous || previous === "allowed") return;
  if (previous === "pending") {
    throw new Error("system.bash already has a pending approval for this exact command");
  }
  throw new Error(
    `system.bash already ${decisionLabel(previous)} for this exact command in this turn; wait for the user to retry it`,
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

async function waitForDecision(
  ctx: ToolContext,
  requestId: string,
): Promise<SystemPermissionRequest> {
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

async function appendPermissionMessage(
  ctx: ToolContext,
  request: SystemPermissionRequest,
): Promise<void> {
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

function normalizeSystemBashArgs(
  ctx: ToolContext,
  request: {
    command: string;
    reason: string;
    cwd?: string;
    timeoutMs?: number;
    maxOutputChars?: number;
  },
) {
  const reason = request.reason.trim();
  if (!reason) throw new Error("system.bash requires a reason");
  return {
    command: request.command,
    reason,
    cwd: request.cwd?.trim() || ctx.workspacePath,
    timeoutMs: clampNumber(request.timeoutMs, DEFAULT_BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS),
    maxOutputChars: clampNumber(request.maxOutputChars, MAX_TOOL_OUTPUT_CHARS, MAX_TOOL_OUTPUT_CHARS),
  };
}

function permissionStatus(status: SystemPermissionRequest["status"]): PermissionDecisionStatus {
  return status === "allowed" ? "allowed" : status === "timed_out" ? "timed_out" : "denied";
}

function decisionLabel(status: SystemPermissionRequest["status"] | PermissionDecisionStatus): string {
  return status === "timed_out" ? "timed out" : status;
}

function permissionGuardKey(command: string, cwd: string): string {
  return JSON.stringify([cwd, command]);
}

function clampNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}
