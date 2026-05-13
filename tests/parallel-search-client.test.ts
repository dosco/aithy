import { describe, expect, test } from "bun:test";
import {
  buildWebSearchArguments,
  parallelWebSearch,
  type McpClientLike,
  type McpToolInfo,
} from "../src/search/parallel-search-client";

describe("Parallel search MCP client", () => {
  test("sends auth only when a Parallel key is configured", async () => {
    const calls: unknown[] = [];
    let requestInit: RequestInit | undefined;
    const client = fakeClient({
      tools: [tool(["objective", "search_queries"])],
      onCall: (params) => calls.push(params),
      resultText: "Result with https://example.test",
    });

    const result = await parallelWebSearch(
      { query: "Parallel MCP", task: "Find docs" },
      { url: "https://search.example.test/mcp", apiKey: "pk-test" },
      {
        createClient: () => client,
        createTransport: (_url, init) => {
          requestInit = init;
          return { id: "transport" };
        },
      },
    );

    expect(requestInit?.headers).toEqual({ Authorization: "Bearer pk-test" });
    expect(calls).toEqual([{
      name: "web_search",
      arguments: {
        objective: "Find docs\n\nSearch query: Parallel MCP",
        search_queries: ["Parallel MCP"],
      },
    }]);
    expect(result.answer).toContain("https://example.test");
    expect(client.closed).toBe(true);
  });

  test("omits auth for anonymous free search", async () => {
    let requestInit: RequestInit | undefined = { headers: {} };
    await parallelWebSearch(
      { query: "aithy", task: "" },
      { url: "https://search.example.test/mcp" },
      {
        createClient: () => fakeClient({ tools: [], resultText: "ok" }),
        createTransport: (_url, init) => {
          requestInit = init;
          return {};
        },
      },
    );

    expect(requestInit).toBeUndefined();
  });

  test("adapts to simple query-shaped tool schemas", () => {
    expect(buildWebSearchArguments(tool(["query"]), {
      query: "current CEO",
      task: "Verify leadership",
    })).toEqual({ query: "current CEO" });
  });
});

function tool(keys: string[]): McpToolInfo {
  return {
    name: "web_search",
    inputSchema: {
      properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
      required: keys,
    },
  };
}

function fakeClient(input: {
  tools: McpToolInfo[];
  resultText: string;
  onCall?: (params: unknown) => void;
}): McpClientLike & { closed: boolean } {
  return {
    closed: false,
    async connect() {},
    async listTools() {
      return { tools: input.tools };
    },
    async callTool(params) {
      input.onCall?.(params);
      return { content: [{ type: "text", text: input.resultText }] };
    },
    async close() {
      this.closed = true;
    },
  };
}
