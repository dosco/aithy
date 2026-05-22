import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import {
  BunSecretStore,
  aithySecretService,
  oauthTokensSecretName,
  type SecretStore,
} from "../settings/secrets";
import type {
  GrokSubscriptionMetadata,
  GrokSubscriptionStatus,
  GrokSubscriptionTokens,
} from "./types";

const metadataKey = "aithy.oauth.xai-grok-subscription.status";
const legacyMetadataKey = "grok.subscription.status";
const tokenSecretName = oauthTokensSecretName("xai-grok-subscription");
const legacyTokenSecretName = "grok.subscription.tokens";

interface MetadataRow {
  value: string;
}

export async function readGrokSubscriptionTokens(
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<GrokSubscriptionTokens | null> {
  const raw = await safeSecretGet(secrets, {
    service: aithySecretService(botId),
    name: tokenSecretName,
  }) ?? await safeSecretGet(secrets, {
    service: aithySecretService(botId),
    name: legacyTokenSecretName,
  });
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GrokSubscriptionTokens>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      idToken: parsed.idToken,
      tokenType: parsed.tokenType || "Bearer",
      expiresAt: parsed.expiresAt,
      obtainedAt: parsed.obtainedAt || new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function writeGrokSubscriptionTokens(
  botId: string,
  tokens: GrokSubscriptionTokens,
  secrets: SecretStore = BunSecretStore,
): Promise<void> {
  await secrets.set({
    service: aithySecretService(botId),
    name: tokenSecretName,
    value: JSON.stringify(tokens),
  });
}

export async function deleteGrokSubscriptionTokens(
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<void> {
  await secrets.delete({
    service: aithySecretService(botId),
    name: tokenSecretName,
  });
  await secrets.delete({
    service: aithySecretService(botId),
    name: legacyTokenSecretName,
  });
}

export async function hasGrokSubscriptionTokens(
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<boolean> {
  return Boolean(await readGrokSubscriptionTokens(botId, secrets));
}

export function readGrokSubscriptionMetadata(dbPath: string): GrokSubscriptionMetadata | null {
  const db = openMetadataDb(dbPath);
  try {
    const row = db.query("SELECT value FROM metadata WHERE key = $key")
      .get({ $key: metadataKey }) as MetadataRow | undefined;
    const legacyRow = row ?? db.query("SELECT value FROM metadata WHERE key = $key")
      .get({ $key: legacyMetadataKey }) as MetadataRow | undefined;
    if (!legacyRow) return null;
    return JSON.parse(legacyRow.value) as GrokSubscriptionMetadata;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function writeGrokSubscriptionMetadata(
  dbPath: string,
  metadata: GrokSubscriptionMetadata,
): void {
  const db = openMetadataDb(dbPath);
  try {
    db.query(`
      INSERT INTO metadata (key, value, hash)
      VALUES ($key, $value, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, hash = NULL
    `).run({ $key: metadataKey, $value: JSON.stringify(metadata) });
  } finally {
    db.close();
  }
}

export async function grokSubscriptionStatus(
  botId: string,
  dbPath: string,
  secrets: SecretStore = BunSecretStore,
): Promise<GrokSubscriptionStatus> {
  const [tokens, metadata] = await Promise.all([
    readGrokSubscriptionTokens(botId, secrets),
    Promise.resolve(readGrokSubscriptionMetadata(dbPath)),
  ]);
  const tokenConnected = Boolean(tokens?.accessToken && tokens.refreshToken);
  const state = tokenConnected ? metadata?.state ?? "connected" : metadata?.state ?? "disconnected";
  return {
    connected: tokenConnected && state === "connected",
    state,
    message: metadata?.message ?? null,
    updatedAt: metadata?.updatedAt ?? null,
    lastConnectedAt: metadata?.lastConnectedAt ?? null,
    expiresAt: tokens?.expiresAt ?? metadata?.expiresAt ?? null,
  };
}

export function openMetadataDb(dbPath: string): Database {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      hash TEXT
    );
  `);
  return db;
}

async function safeSecretGet(
  secrets: SecretStore,
  options: { service: string; name: string },
): Promise<string | null> {
  try {
    return await secrets.get(options);
  } catch {
    return null;
  }
}
