import type { McpServerProfile } from "../settings/types";

const MCP_ID = /^[a-z0-9-]{1,32}$/;

export function assertMcpServerId(id: string): string {
  if (!MCP_ID.test(id)) throw new Error("MCP server id must match [a-z0-9-]{1,32}");
  return id;
}

export function mcpCapability(id: string): string {
  return `mcp.${assertMcpServerId(id)}`;
}

export interface McpRegistrySnapshot {
  serverId: string;
  profile: McpServerProfile;
  functions: import("@ax-llm/ax").AxFunction[];
  serverInfo?: { name: string; version: string };
  error?: string;
}
