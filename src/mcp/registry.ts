import {
  AxMCPClient,
  AxMCPHTTPSSETransport,
  AxMCPStreamableHTTPTransport,
  type AxFunction,
} from "@ax-llm/ax";
import { readMcpServerToken, type SecretStore } from "../settings/secrets";
import type { McpServerProfile } from "../settings/types";
import type { McpRegistrySnapshot } from "./types";
import { normalizeMcpProfile } from "./profile";

const INIT_TIMEOUT_MS = 10_000;

export class McpRegistry {
  private readonly entries = new Map<string, Promise<McpRegistrySnapshot>>();
  private readonly transports: Array<{ close(): void }> = [];
  private leases = 0;
  private retired = false;
  private closed = false;

  constructor(
    private readonly profiles: Record<string, McpServerProfile>,
    private readonly botId: string,
    private readonly secrets?: SecretStore,
  ) {}

  async snapshot(): Promise<McpRegistrySnapshot[]> {
    return Promise.all(Object.entries(this.profiles)
      .filter(([, profile]) => profile.enabled)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, profile]) => this.entry(id, profile)));
  }

  async acquire(): Promise<{ snapshots: McpRegistrySnapshot[]; release(): void }> {
    if (this.retired) throw new Error("MCP registry is retired");
    this.leases += 1;
    try {
      const snapshots = await this.snapshot();
      let released = false;
      return {
        snapshots,
        release: () => {
          if (released) return;
          released = true;
          this.leases -= 1;
          if (this.retired && this.leases === 0) this.closeNow();
        },
      };
    } catch (error) {
      this.leases -= 1;
      if (this.retired && this.leases === 0) this.closeNow();
      throw error;
    }
  }

  refresh(id?: string): void {
    if (id) this.entries.delete(id);
    else this.entries.clear();
  }

  retire(): void {
    this.retired = true;
    if (this.leases === 0) this.closeNow();
  }

  close(): void {
    this.retired = true;
    this.closeNow();
  }

  private closeNow(): void {
    if (this.closed) return;
    this.closed = true;
    for (const transport of this.transports) transport.close();
    this.transports.length = 0;
  }

  private entry(id: string, profile: McpServerProfile): Promise<McpRegistrySnapshot> {
    const existing = this.entries.get(id);
    if (existing) return existing;
    const created = this.connect(id, profile).catch((error) => ({
      serverId: id,
      profile,
      functions: [],
      error: error instanceof Error ? error.message : String(error),
    }));
    this.entries.set(id, created);
    return created;
  }

  private async connect(id: string, profile: McpServerProfile): Promise<McpRegistrySnapshot> {
    profile = normalizeMcpProfile(id, profile);
    const token = profile.authMode === "none"
      ? undefined
      : await readMcpServerToken(id, this.botId, this.secrets);
    if (profile.authMode !== "none" && !token) throw new Error("MCP token is not configured");
    const headers = profile.authMode === "header" && profile.headerName && token
      ? { [profile.headerName]: token }
      : undefined;
    const options = {
      ...(headers ? { headers } : {}),
      ...(profile.authMode === "bearer" && token ? { authorization: `Bearer ${token}` } : {}),
      ssrfProtection: { allowLoopback: profile.allowLoopback, allowHTTP: profile.allowHttp },
    };
    const transport = profile.transport === "sse"
      ? new AxMCPHTTPSSETransport(profile.url, options)
      : new AxMCPStreamableHTTPTransport(profile.url, options);
    this.transports.push(transport);
    const client = new AxMCPClient(transport);
    await withTimeout(client.init(), INIT_TIMEOUT_MS);
    const functions = client.toFunction().filter((fn) =>
      (profile.exposePrompts || !fn.name.startsWith("prompt_"))
      && (profile.exposeResources || !fn.name.startsWith("resource_"))
    );
    return { serverId: id, profile, functions: functions as AxFunction[], serverInfo: client.getServerInfo() };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`MCP initialization timed out after ${ms / 1000}s`)), ms);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
