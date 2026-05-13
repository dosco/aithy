import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const PARALLEL_WEB_SEARCH_TOOL = "web_search";

export interface ParallelSearchInput {
  query: string;
  task: string;
}

export interface ParallelSearchConfig {
  url: string;
  apiKey?: string;
}

export interface ParallelSearchResult {
  answer: string;
  provider: "parallel";
  rawContent: string;
}

export interface McpToolInfo {
  name: string;
  inputSchema?: {
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: McpToolInfo[] }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<unknown>;
  close(): Promise<void>;
}

export interface ParallelSearchDeps {
  createClient?: () => McpClientLike;
  createTransport?: (url: URL, requestInit?: RequestInit) => unknown;
}

export async function parallelWebSearch(
  input: ParallelSearchInput,
  config: ParallelSearchConfig,
  deps: ParallelSearchDeps = {},
): Promise<ParallelSearchResult> {
  const client = (deps.createClient ?? createDefaultClient)();
  const requestInit = config.apiKey
    ? { headers: { Authorization: `Bearer ${config.apiKey}` } }
    : undefined;
  const transport = (deps.createTransport ?? createDefaultTransport)(
    new URL(config.url),
    requestInit,
  );

  try {
    await client.connect(transport);
    const tool = await findWebSearchTool(client);
    const result = await client.callTool({
      name: PARALLEL_WEB_SEARCH_TOOL,
      arguments: buildWebSearchArguments(tool, input),
    });
    const rawContent = extractMcpText(result);
    return {
      answer: rawContent,
      provider: "parallel",
      rawContent,
    };
  } finally {
    await client.close();
  }
}

export async function findWebSearchTool(client: McpClientLike): Promise<McpToolInfo | undefined> {
  const tools = await client.listTools();
  return tools.tools.find((tool) => tool.name === PARALLEL_WEB_SEARCH_TOOL);
}

export function buildWebSearchArguments(
  tool: McpToolInfo | undefined,
  input: ParallelSearchInput,
): Record<string, unknown> {
  const query = input.query.trim();
  const task = input.task.trim();
  const objective = task ? `${task}\n\nSearch query: ${query}` : query;
  const keys = toolSchemaKeys(tool);
  if (keys.size === 0) {
    return { objective, search_queries: [query] };
  }

  const args: Record<string, unknown> = {};
  if (keys.has("objective")) args.objective = objective;
  if (keys.has("query")) args.query = query;
  if (keys.has("search_query")) args.search_query = query;
  if (keys.has("search_queries")) args.search_queries = [query];
  if (keys.has("queries")) args.queries = [query];
  if (keys.has("max_results") && isRequired(tool, "max_results")) args.max_results = 5;
  if (keys.has("maxResults") && isRequired(tool, "maxResults")) args.maxResults = 5;
  if (keys.has("input")) args.input = objective;

  return Object.keys(args).length > 0 ? args : { objective, search_queries: [query] };
}

export function extractMcpText(result: unknown): string {
  const parts: string[] = [];
  if (isRecord(result)) {
    const content = result.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        const text = mcpContentText(item);
        if (text) parts.push(text);
      }
    }
    if (parts.length === 0 && "structuredContent" in result) {
      parts.push(JSON.stringify(result.structuredContent, null, 2));
    }
  }
  return parts.join("\n\n").trim();
}

function createDefaultClient(): McpClientLike {
  return new Client({
    name: "aithy-parallel-search",
    version: "0.1.0",
  }) as unknown as McpClientLike;
}

function createDefaultTransport(url: URL, requestInit?: RequestInit): unknown {
  return new StreamableHTTPClientTransport(url, { requestInit });
}

function toolSchemaKeys(tool: McpToolInfo | undefined): Set<string> {
  return new Set([
    ...Object.keys(tool?.inputSchema?.properties ?? {}),
    ...(tool?.inputSchema?.required ?? []),
  ]);
}

function isRequired(tool: McpToolInfo | undefined, key: string): boolean {
  return tool?.inputSchema?.required?.includes(key) ?? false;
}

function mcpContentText(item: unknown): string | undefined {
  if (!isRecord(item)) return undefined;
  if (item.type === "text" && typeof item.text === "string") return item.text;
  if (item.type === "resource" && isRecord(item.resource)) {
    const text = item.resource.text;
    return typeof text === "string" ? text : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
