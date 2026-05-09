import { f, fn } from "@ax-llm/ax";
import type { AppConfig } from "../../config/env";
import {
  DEFAULT_BASH_TIMEOUT_MS,
  MAX_BASH_TIMEOUT_MS,
  MAX_TOOL_OUTPUT_CHARS
} from "../../config/limits";
import type { ToolContext } from "../tool-context";

export function createSandboxTools(ctx: ToolContext, sandboxProvider: AppConfig["sandboxProvider"]) {
  return [
    createEditTool(ctx, sandboxProvider),
    createBashTool(ctx, sandboxProvider)
  ];
}

function createEditTool(ctx: ToolContext, sandboxProvider: AppConfig["sandboxProvider"]) {
  return fn("edit")
    .namespace("sandbox")
    .description(editDescription(sandboxProvider))
    .arg("path", f.string("Sandbox path under /workspace"))
    .arg("search", f.string("Exact text block to replace"))
    .arg("replace", f.string("Replacement text block"))
    .returnsField("path", f.string("Sandbox path edited"))
    .returnsField("sizeBytes", f.number("Updated file size in bytes"))
    .handler(({ path, search, replace }) => ctx.sandbox.edit(ctx.session.sandboxSessionId, path, search, replace))
    .build();
}

function createBashTool(ctx: ToolContext, sandboxProvider: AppConfig["sandboxProvider"]) {
  return fn("bash")
    .namespace("sandbox")
    .description(bashDescription(sandboxProvider))
    .arg("command", f.string("Bash command to run"))
    .arg("cwd", f.string("Working directory under /workspace").optional())
    .arg("timeoutMs", f.number("Timeout in milliseconds").optional())
    .arg("maxOutputChars", f.number("Maximum stdout/stderr characters").optional())
    .returnsField("exitCode", f.number("Command exit code"))
    .returnsField("stdout", f.string("Standard output, truncated when large"))
    .returnsField("stderr", f.string("Standard error, truncated when large"))
    .returnsField("timedOut", f.boolean("Whether the host timeout killed the process"))
    .example({
      title: "List files in the sandbox working directory",
      code: "await sandbox.bash({ command: 'ls -la' });"
    })
    .handler(async (request) => {
      const args = normalizeBashArgs(request);
      ctx.events.emit({
        type: "sandbox.exec",
        conversationId: ctx.session.conversationId,
        command: args.command
      });
      return ctx.sandbox.bash(ctx.session.sandboxSessionId, args);
    })
    .build();
}

function editDescription(sandboxProvider: AppConfig["sandboxProvider"]): string {
  if (sandboxProvider === "disabled") {
    return "Perform one exact search-and-replace edit in a UTF-8 file under /workspace, which maps to this conversation's local host workspace.";
  }
  return "Perform one exact search-and-replace edit in a UTF-8 file under /workspace.";
}

function bashDescription(sandboxProvider: AppConfig["sandboxProvider"]): string {
  if (sandboxProvider === "disabled") {
    return "Execute a command locally through Bun Shell. Use this for ANY shell task — listing files, reading files, running scripts, grep, git, package managers, etc. Default cwd is /workspace, which maps to this conversation's local host workspace. Returns exitCode, stdout, and stderr; you must call this and read the output rather than describing what the command would do.";
  }
  return "Execute a shell command in the sandbox. Use this for ANY shell task — listing files, reading files, running scripts, grep, git, package managers, etc. Default cwd is /workspace (the sandbox root). Returns exitCode, stdout, and stderr; you must call this and read the output rather than describing what the command would do.";
}

function normalizeBashArgs(request: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}) {
  return {
    command: request.command,
    cwd: request.cwd,
    timeoutMs: clampNumber(request.timeoutMs, DEFAULT_BASH_TIMEOUT_MS, MAX_BASH_TIMEOUT_MS),
    maxOutputChars: clampNumber(request.maxOutputChars, MAX_TOOL_OUTPUT_CHARS, MAX_TOOL_OUTPUT_CHARS)
  };
}

function clampNumber(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}
