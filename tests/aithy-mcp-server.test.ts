import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  aithyMcpServerConfigChanged,
  createAithyMcpServer,
  type AithyMcpServerStores,
} from "../src/mcp/aithy-server";

describe("Aithy read-only MCP server", () => {
  test("restarts a same-port listener when its bearer token changes", () => {
    expect(aithyMcpServerConfigChanged(true, 3111, "old", 3111, "old")).toBe(false);
    expect(aithyMcpServerConfigChanged(true, 3111, "old", 3111, "new")).toBe(true);
    expect(aithyMcpServerConfigChanged(true, 3111, "old", 3112, "old")).toBe(true);
  });

  test("exposes bounded read-only stores without marking memory recalled", async () => {
    let searchOptions: unknown;
    const stores = {
      memory: { search: async (_queries: string[], options: unknown) => { searchOptions = options; return [{ id: "m1", title: "Memory" }]; } },
      skills: {
        getAll: () => [{ id: "skill", name: "Skill", description: "Useful", when_to_use: null, disabled_at: null, disable_model_invocation: false }],
        get: () => ({ id: "skill", name: "Skill", description: "Useful", when_to_use: null, body: "Do it", files: [], allowed_tools: null }),
      },
      artifacts: {
        recent: (_limit: number, sessionId?: string) => [{ id: "a1", sessionId: sessionId ?? "s1", runId: null, title: "Report", description: null, filename: "report.md", mimeType: "text/markdown", sizeBytes: 10, previewKind: "text", textPreview: "preview", createdAt: "2026-01-01T00:00:00.000Z" }],
        get: () => null,
      },
    } as unknown as AithyMcpServerStores;
    const server = createAithyMcpServer(stores);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "artifacts.list", "artifacts.read", "memory.search", "skills.list", "skills.read",
    ]);
    await client.callTool({ name: "memory.search", arguments: { query: "project" } });
    expect(searchOptions).toMatchObject({ markRecalled: false, limit: 8 });
    const artifacts = await client.callTool({ name: "artifacts.list", arguments: { sessionId: "s2" } });
    expect((artifacts.content as Array<{ text: string }>)[0]?.text).toContain('"sessionId": "s2"');
    await client.close();
    await server.close();
  });
});
