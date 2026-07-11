import { describe, expect, test } from "bun:test";
import { mcpCapability, assertMcpServerId } from "../src/mcp/types";
import { permissionOptionsForCapability } from "../src/security/capability-policy";
import { McpRegistry } from "../src/mcp/registry";
import { mcpServerSecretName } from "../src/settings/secrets";
import { normalizeMcpProfile } from "../src/mcp/profile";
import { normalizePort, secureTokenMatches } from "../src/mcp/aithy-server";

describe("MCP contracts", () => {
  test("isolates malformed persisted profiles as per-server errors", async () => {
    const registry = new McpRegistry({
      "INVALID ID": {
        label: "Broken",
        url: "https://example.test/mcp",
        transport: "streamable-http",
        authMode: "none",
        enabled: true,
      },
    }, "default");
    try {
      const snapshots = await registry.snapshot();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.functions).toEqual([]);
      expect(snapshots[0]?.error).toMatch(/server id/i);
    } finally {
      registry.close();
    }
  });
  test("validates ids and derives stable capability and secret names", () => {
    expect(assertMcpServerId("local-tools")).toBe("local-tools");
    expect(mcpCapability("local-tools")).toBe("mcp.local-tools");
    expect(mcpServerSecretName("local-tools")).toBe("aithy.mcp.local-tools.token");
    expect(() => assertMcpServerId("Local Tools")).toThrow(/must match/);
  });

  test("offers server-wide and exact-tool persisted grants", () => {
    expect(permissionOptionsForCapability("mcp.local-tools", { command: "lookup" })).toEqual([
      { kind: "global", label: "Always allow this MCP server", value: null },
      { kind: "exact_command", label: "Always allow this tool", value: "lookup" },
    ]);
  });

  test("requires explicit exceptions for HTTP and loopback MCP targets", () => {
    const profile = { label: "Local", url: "http://127.0.0.1:3001/mcp", transport: "streamable-http" as const,
      authMode: "none" as const, enabled: true };
    expect(() => normalizeMcpProfile("local", profile)).toThrow(/HTTP exception/);
    expect(() => normalizeMcpProfile("local", { ...profile, allowHttp: true })).toThrow(/loopback exception/);
    expect(normalizeMcpProfile("local", { ...profile, allowHttp: true, allowLoopback: true }).url)
      .toBe("http://127.0.0.1:3001/mcp");
  });

  test("authenticates bearer tokens and normalizes the local server port", () => {
    expect(secureTokenMatches("Bearer secret", "secret")).toBe(true);
    expect(secureTokenMatches("Bearer secrets", "secret")).toBe(false);
    expect(secureTokenMatches(null, "secret")).toBe(false);
    expect(normalizePort(undefined)).toBe(3111);
    expect(normalizePort(4123)).toBe(4123);
  });

  test("retired registries remain leased until the turn releases", async () => {
    const registry = new McpRegistry({}, "test");
    const lease = await registry.acquire();
    registry.retire();
    expect(lease.snapshots).toEqual([]);
    lease.release();
    await expect(registry.acquire()).rejects.toThrow(/retired/);
  });
});
