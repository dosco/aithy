import type { AxAgentFunction, AxFunction } from "@ax-llm/ax";
import { MAX_TOOL_OUTPUT_CHARS } from "../config/limits";
import { requireToolPermission } from "../security/permission-gate";
import type { ToolContext } from "../agent/tool-context";
import { mcpCapability } from "./types";

const MAX_DESCRIPTION_CHARS = 1_000;

export function createMcpAgentTools(
  snapshots: readonly { serverId: string; functions: readonly AxFunction[] }[],
  ctx: ToolContext,
): AxAgentFunction[] {
  return snapshots.flatMap((snapshot) => snapshot.functions.map((remote) => ({
    ...remote,
    ...(remote.parameters ? { parameters: structuredClone(remote.parameters) } : {}),
    ...(remote.returns ? { returns: structuredClone(remote.returns) } : {}),
    namespace: `mcp_${snapshot.serverId.replaceAll("-", "_")}`,
    description: cap(remote.description, MAX_DESCRIPTION_CHARS),
    func: async (args: unknown) => {
      await requireToolPermission(ctx, {
        capability: mcpCapability(snapshot.serverId),
        toolName: `mcp_${snapshot.serverId}.${remote.name}`,
        command: remote.name,
        reason: `Call ${remote.name} on MCP server ${snapshot.serverId}`,
        matchContext: { command: remote.name },
        args,
      });
      return capResult(await remote.func(args as never));
    },
  }))) as AxAgentFunction[];
}

function cap(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 13)} [truncated]`;
}

function capResult(value: unknown): unknown {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized || serialized.length <= MAX_TOOL_OUTPUT_CHARS) return value;
  return `${serialized.slice(0, MAX_TOOL_OUTPUT_CHARS - 13)} [truncated]`;
}
