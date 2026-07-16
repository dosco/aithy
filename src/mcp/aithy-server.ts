import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { SqliteArtifactStore } from "../artifacts/artifact-store";
import type { SqliteMemoryStore } from "../memory/memory-store";
import { aithyMcpServerTokenName, aithySecretService, BunSecretStore, type SecretStore } from "../settings/secrets";
import type { RuntimeSettings } from "../settings/types";
import { formatSkillContent, type SqliteSkillsStore } from "../skills/skills-store";
import type { SqliteKnowledgeStore } from "../knowledge/knowledge-store";

const DEFAULT_PORT = 3111;
const MAX_RESPONSE_CHARS = 32_000;

export interface AithyMcpServerStores {
  memory: SqliteMemoryStore;
  knowledge: SqliteKnowledgeStore;
  skills: SqliteSkillsStore;
  artifacts: SqliteArtifactStore;
}

export class AithyMcpServerManager {
  private server?: Bun.Server<undefined>;
  private port?: number;
  private token?: string;

  constructor(
    private readonly stores: AithyMcpServerStores,
    private readonly botId: string,
    private readonly secrets: SecretStore = BunSecretStore,
  ) {}

  async reconfigure(settings: RuntimeSettings): Promise<void> {
    const enabled = settings.mcpServerEnabled === true;
    const port = normalizePort(settings.mcpServerPort);
    if (!enabled) return this.close();
    const token = await this.secrets.get({
      service: aithySecretService(this.botId),
      name: aithyMcpServerTokenName(),
    });
    if (!token) return this.close();
    if (!aithyMcpServerConfigChanged(Boolean(this.server), this.port, this.token, port, token)) return;
    this.close();
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: (request) => this.handle(request, token),
    });
    this.port = port;
    this.token = token;
  }

  status(): { running: boolean; port: number } {
    return { running: Boolean(this.server), port: this.port ?? DEFAULT_PORT };
  }

  close(): void {
    this.server?.stop(true);
    this.server = undefined;
    this.port = undefined;
    this.token = undefined;
  }

  private async handle(request: Request, token: string): Promise<Response> {
    if (!secureTokenMatches(request.headers.get("authorization"), token)) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "www-authenticate": "Bearer" } });
    }
    if (new URL(request.url).pathname !== "/mcp") return new Response("Not found", { status: 404 });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    const server = createAithyMcpServer(this.stores);
    await server.connect(transport);
    return transport.handleRequest(request);
  }
}

export function createAithyMcpServer(stores: AithyMcpServerStores): McpServer {
  const server = new McpServer({ name: "aithy-readonly", version: "1.0.0" });
  server.registerTool("memory.search", {
    description: "Search Aithy's durable memories without changing recall counters.",
    inputSchema: { query: z.string().min(1).max(2_000), limit: z.number().int().min(1).max(20).optional() },
    annotations: readOnlyAnnotations(),
  }, async ({ query, limit }) => textResult(await stores.memory.search([query], { limit: limit ?? 8, markRecalled: false })));
  server.registerTool("knowledge.search", {
    description: "Search enabled Knowledge Library bundles without changing retrieval counters.",
    inputSchema: {
      query: z.string().min(1).max(2_000),
      bundleId: z.string().uuid().optional(),
      type: z.string().min(1).max(200).optional(),
      tags: z.array(z.string().min(1).max(100)).max(20).optional(),
      limit: z.number().int().min(1).max(10).optional(),
    },
    annotations: readOnlyAnnotations(),
  }, async ({ query, bundleId, type, tags, limit }) => textResult(await stores.knowledge.searchSemantic(query, {
    bundleId, type, tags, limit: limit ?? 5, increment: false,
  })));
  server.registerTool("knowledge.read", {
    description: "Read one bounded Knowledge Library concept or section without changing retrieval counters.",
    inputSchema: { id: z.string().uuid(), section: z.string().min(1).max(500).optional() },
    annotations: readOnlyAnnotations(),
  }, async ({ id, section }) => {
    const concept = stores.knowledge.read(id, { section, increment: false });
    return concept ? textResult(concept) : errorResult("Knowledge concept or section not found");
  });
  server.registerTool("skills.list", {
    description: "List enabled model-invocable skills.", inputSchema: {}, annotations: readOnlyAnnotations(),
  }, async () => textResult(stores.skills.getAll()
    .filter((skill) => !skill.disabled_at && !skill.disable_model_invocation)
    .map(({ id, name, description, when_to_use }) => ({ id, name, description, when_to_use }))));
  server.registerTool("skills.read", {
    description: "Read a skill by ID without changing skill usage counters.",
    inputSchema: { id: z.string().min(1).max(200) }, annotations: readOnlyAnnotations(),
  }, async ({ id }) => {
    const skill = stores.skills.get(id);
    return skill ? textResult({ id: skill.id, name: skill.name, content: formatSkillContent(skill) }) : errorResult("Skill not found");
  });
  server.registerTool("artifacts.list", {
    description: "List bounded artifact metadata, optionally for one session.",
    inputSchema: { sessionId: z.string().min(1).max(200).optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: readOnlyAnnotations(),
  }, async ({ sessionId, limit }) => textResult(stores.artifacts.recent(limit ?? 50, sessionId).map(artifactPreview)));
  server.registerTool("artifacts.read", {
    description: "Read stored artifact metadata and its bounded text preview; never reads the backing file.",
    inputSchema: { id: z.string().uuid() }, annotations: readOnlyAnnotations(),
  }, async ({ id }) => {
    const artifact = stores.artifacts.get(id);
    return artifact ? textResult(artifactPreview(artifact)) : errorResult("Artifact not found");
  });
  return server;
}

export function normalizePort(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 1024 && value! <= 65_535 ? value! : DEFAULT_PORT;
}

export function aithyMcpServerConfigChanged(
  running: boolean,
  currentPort: number | undefined,
  currentToken: string | undefined,
  nextPort: number,
  nextToken: string,
): boolean {
  return !running || currentPort !== nextPort || currentToken !== nextToken;
}

export function secureTokenMatches(header: string | null, expected: string): boolean {
  const candidate = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (candidate.length !== expected.length || candidate.length === 0) return false;
  let mismatch = 0;
  for (let i = 0; i < candidate.length; i += 1) mismatch |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function artifactPreview(entry: ReturnType<SqliteArtifactStore["get"]> extends infer T ? Exclude<T, null> : never) {
  const { id, sessionId, runId, title, description, filename, mimeType, sizeBytes, previewKind, textPreview, createdAt } = entry;
  return { id, sessionId, runId, title, description, filename, mimeType, sizeBytes, previewKind, textPreview, createdAt };
}

function textResult(value: unknown) {
  const json = JSON.stringify(value, null, 2);
  const bytes = new TextEncoder().encode(json);
  const text = bytes.length <= MAX_RESPONSE_CHARS ? json
    : `${new TextDecoder().decode(bytes.slice(0, MAX_RESPONSE_CHARS - 13))} [truncated]`;
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function readOnlyAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
}
