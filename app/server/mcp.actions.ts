import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { McpRegistry } from "../../src/mcp/registry";
import { assertMcpServerId } from "../../src/mcp/types";
import { normalizeMcpProfile } from "../../src/mcp/profile";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import {
  BunSecretStore,
  aithyMcpServerTokenName,
  aithySecretService,
  deleteMcpServerToken,
  mcpServerSecretName,
  normalizePostedSecret,
  readAithyMcpServerToken,
  readMcpServerToken,
  writeAithyMcpServerToken,
  writeMcpServerToken,
  deleteAithyMcpServerToken,
  type SecretStore,
} from "../../src/settings/secrets";
import type { McpServerProfile } from "../../src/settings/types";

const profileInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,32}$/),
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(1_000),
  transport: z.enum(["streamable-http", "sse"]),
  authMode: z.enum(["none", "bearer", "header"]),
  headerName: z.string().trim().max(100).optional().nullable(),
  enabled: z.boolean(), exposePrompts: z.boolean().optional(), exposeResources: z.boolean().optional(),
  allowLoopback: z.boolean().optional(), allowHttp: z.boolean().optional(),
  token: z.string().max(8_000).optional(), clearToken: z.boolean().optional(),
});

export const saveMcpServer = createServerFn({ method: "POST" }).inputValidator(profileInput).handler(async ({ data }) => {
  assertLoopbackRequest(getRequest());
  const runtime = await getAithyRuntime();
  const id = assertMcpServerId(data.id);
  const profile = normalizeProfile(data);
  const token = normalizePostedSecret(data.token);
  const current = runtime.settings.load().runtime;
  const previousToken = await readMcpServerToken(id, runtime.config.botId);
  if (token) await writeMcpServerToken(id, token, runtime.config.botId);
  if (data.clearToken) await deleteMcpServerToken(id, runtime.config.botId);
  try {
    const next: McpServerProfile = {
      ...profile,
      secretVersion: Math.max(0, current.mcpServers?.[id]?.secretVersion ?? 0)
        + (token || data.clearToken ? 1 : 0),
      validation: { status: "unknown" },
    };
    const settings = await runtime.updateSettings({ runtime: { mcpServers: { ...current.mcpServers, [id]: next } } });
    return { settings, server: await serverStatus(runtime.config.botId, id, next) };
  } catch (error) {
    await restoreToken(id, runtime.config.botId, previousToken);
    await restoreMcpProfiles(runtime, current.mcpServers ?? {});
    throw error;
  }
});

export const removeMcpServer = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const current = runtime.settings.load().runtime;
    const next = { ...current.mcpServers };
    delete next[data.id];
    const previousToken = await readMcpServerToken(data.id, runtime.config.botId);
    await deleteMcpServerToken(data.id, runtime.config.botId);
    try { return { settings: await runtime.updateSettings({ runtime: { mcpServers: next } }) }; }
    catch (error) {
      await restoreToken(data.id, runtime.config.botId, previousToken);
      await restoreMcpProfiles(runtime, current.mcpServers ?? {});
      throw error;
    }
  });

export const testMcpServer = createServerFn({ method: "POST" }).inputValidator(profileInput).handler(async ({ data }) => {
  assertLoopbackRequest(getRequest());
  const runtime = await getAithyRuntime();
  const id = assertMcpServerId(data.id);
  const profile = normalizeProfile(data);
  const token = normalizePostedSecret(data.token);
  const secrets = token ? tokenOverride(id, token) : BunSecretStore;
  const registry = new McpRegistry({ [id]: { ...profile, enabled: true } }, runtime.config.botId, secrets);
  try {
    const snapshot = (await registry.snapshot())[0]!;
    if (snapshot.error) throw new Error(snapshot.error);
    return { ok: true, toolCount: snapshot.functions.length, serverInfo: snapshot.serverInfo ?? null };
  } finally {
    registry.close();
  }
});

export const configureAithyMcpServer = createServerFn({ method: "POST" })
  .inputValidator(z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65_535) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const previousSettings = runtime.settings.load().runtime;
    const previousToken = await readAithyMcpServerToken(runtime.config.botId);
    let token = previousToken;
    let revealedToken: string | null = null;
    if (data.enabled && !token) {
      token = randomToken(); revealedToken = token;
      await writeAithyMcpServerToken(token, runtime.config.botId);
    }
    try {
      const settings = await runtime.updateSettings({ runtime: { mcpServerEnabled: data.enabled, mcpServerPort: data.port } });
      return { settings, status: { ...runtime.mcpServer.status(), configured: Boolean(token) }, token: revealedToken };
    } catch (error) {
      if (!previousToken && token) await BunSecretStore.delete({ service: aithySecretService(runtime.config.botId), name: aithyMcpServerTokenName() });
      await restoreAithyMcpSettings(runtime, previousSettings.mcpServerEnabled, previousSettings.mcpServerPort);
      throw error;
    }
  });

export const regenerateAithyMcpServerToken = createServerFn({ method: "POST" }).handler(async () => {
  assertLoopbackRequest(getRequest());
  const runtime = await getAithyRuntime();
  const previousToken = await readAithyMcpServerToken(runtime.config.botId);
  const token = randomToken();
  await writeAithyMcpServerToken(token, runtime.config.botId);
  try {
    await runtime.mcpServer.reconfigure(runtime.settings.load().runtime);
    return { token, status: { ...runtime.mcpServer.status(), configured: true } };
  } catch (error) {
    if (previousToken) await writeAithyMcpServerToken(previousToken, runtime.config.botId);
    else await deleteAithyMcpServerToken(runtime.config.botId);
    await runtime.mcpServer.reconfigure(runtime.settings.load().runtime).catch(() => {});
    throw error;
  }
});

function normalizeProfile(data: z.infer<typeof profileInput>): McpServerProfile {
  return normalizeMcpProfile(data.id, { label: data.label, url: data.url, transport: data.transport, authMode: data.authMode,
    headerName: data.headerName || null, enabled: data.enabled, exposePrompts: data.exposePrompts ?? false,
    exposeResources: data.exposeResources ?? false, allowLoopback: data.allowLoopback ?? false, allowHttp: data.allowHttp ?? false });
}

async function serverStatus(botId: string, id: string, profile: McpServerProfile) {
  return { id, profile, tokenConfigured: Boolean(await readMcpServerToken(id, botId)) };
}

async function restoreToken(id: string, botId: string, previous: string | undefined) {
  if (previous) await writeMcpServerToken(id, previous, botId);
  else await deleteMcpServerToken(id, botId);
}

async function restoreMcpProfiles(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  profiles: Record<string, McpServerProfile>,
) {
  await runtime.updateSettings({ runtime: { mcpServers: profiles } }).catch(() => {
    runtime.settings.save({ runtime: { mcpServers: profiles } });
  });
}

async function restoreAithyMcpSettings(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  enabled: boolean | undefined,
  port: number | undefined,
) {
  await runtime.updateSettings({ runtime: { mcpServerEnabled: enabled, mcpServerPort: port } }).catch(() => {
    runtime.settings.save({ runtime: { mcpServerEnabled: enabled, mcpServerPort: port } });
  });
}

function tokenOverride(id: string, token: string): SecretStore {
  return {
    get: (options) => options.name === mcpServerSecretName(id) ? Promise.resolve(token) : BunSecretStore.get(options),
    set: (options) => BunSecretStore.set(options), delete: (options) => BunSecretStore.delete(options),
  };
}

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
