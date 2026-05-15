import { f, fn } from "@ax-llm/ax";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  MAX_TOOL_OUTPUT_CHARS,
} from "../../config/limits";
import { requireToolPermission } from "../../security/permission-gate";
import { runHostBash } from "../../system/host-bash";
import type { ToolContext } from "../tool-context";

const SYSTEM_BASH_CAPABILITY = "system.bash";

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
      await requireToolPermission(ctx, {
        capability: SYSTEM_BASH_CAPABILITY,
        toolName: SYSTEM_BASH_CAPABILITY,
        command: args.command,
        cwd: args.cwd,
        reason: args.reason,
        targetKind: "command",
        targetValue: args.command,
        matchContext: { command: args.command, cwd: args.cwd },
        args,
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

function clampNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}
