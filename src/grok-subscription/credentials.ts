import type { SecretStore } from "../settings/secrets";
import {
  discoverGrokSubscriptionEndpoints,
  type FetchLike,
  isEntitlementFailure,
  isTerminalTokenFailure,
  refreshGrokSubscriptionTokens,
  tokensExpiring,
} from "./protocol";
import {
  deleteGrokSubscriptionTokens,
  readGrokSubscriptionMetadata,
  readGrokSubscriptionTokens,
  writeGrokSubscriptionMetadata,
  writeGrokSubscriptionTokens,
} from "./store";
import type {
  GrokSubscriptionCredentials,
  GrokSubscriptionMetadata,
  GrokSubscriptionState,
  GrokSubscriptionTokens,
} from "./types";

const refreshLocks = new Map<string, Promise<GrokSubscriptionCredentials>>();

export class GrokSubscriptionAuthError extends Error {
  constructor(
    message: string,
    public readonly state: GrokSubscriptionState,
  ) {
    super(message);
    this.name = "GrokSubscriptionAuthError";
  }
}

export async function resolveGrokSubscriptionCredentials(input: {
  botId: string;
  stateDbPath: string;
  forceRefresh?: boolean;
  secrets?: SecretStore;
  fetchFn?: FetchLike;
}): Promise<GrokSubscriptionCredentials> {
  const metadata = readGrokSubscriptionMetadata(input.stateDbPath);
  assertUsableMetadata(metadata);
  const tokens = await readGrokSubscriptionTokens(input.botId, input.secrets);
  if (!tokens) throw missingAuthError();
  if (!input.forceRefresh && !tokensExpiring(tokens)) {
    return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
  }

  const lockKey = `${input.botId}:${input.stateDbPath}`;
  const existing = refreshLocks.get(lockKey);
  if (existing) return existing;
  const promise = refreshLocked(input).finally(() => refreshLocks.delete(lockKey));
  refreshLocks.set(lockKey, promise);
  return promise;
}

export async function disconnectGrokSubscription(input: {
  botId: string;
  stateDbPath: string;
  secrets?: SecretStore;
}): Promise<void> {
  await deleteGrokSubscriptionTokens(input.botId, input.secrets);
  writeGrokSubscriptionMetadata(input.stateDbPath, metadata("disconnected", "Signed out of Grok."));
}

export function markGrokSubscriptionConnected(
  stateDbPath: string,
  tokens: GrokSubscriptionTokens,
): void {
  writeGrokSubscriptionMetadata(stateDbPath, {
    state: "connected",
    message: "Grok subscription connected.",
    updatedAt: new Date().toISOString(),
    lastConnectedAt: new Date().toISOString(),
    expiresAt: tokens.expiresAt,
  });
}

export function markGrokEntitlementDenied(stateDbPath: string): void {
  writeGrokSubscriptionMetadata(
    stateDbPath,
    metadata(
      "tier_denied",
      "The connected Grok subscription is not authorized for xAI API access. Use the separate xAI API-key provider in Aithy, or upgrade the subscription.",
    ),
  );
}

async function refreshLocked(input: {
  botId: string;
  stateDbPath: string;
  forceRefresh?: boolean;
  secrets?: SecretStore;
  fetchFn?: FetchLike;
}): Promise<GrokSubscriptionCredentials> {
  assertUsableMetadata(readGrokSubscriptionMetadata(input.stateDbPath));
  const tokens = await readGrokSubscriptionTokens(input.botId, input.secrets);
  if (!tokens) throw missingAuthError();
  if (!input.forceRefresh && !tokensExpiring(tokens)) {
    return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt };
  }

  try {
    const endpoints = await discoverGrokSubscriptionEndpoints(input.fetchFn);
    const refreshed = await refreshGrokSubscriptionTokens({
      tokenEndpoint: endpoints.tokenEndpoint,
      tokens,
      fetchFn: input.fetchFn,
    });
    await writeGrokSubscriptionTokens(input.botId, refreshed, input.secrets);
    markGrokSubscriptionConnected(input.stateDbPath, refreshed);
    return { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
  } catch (error) {
    if (isEntitlementFailure(error)) {
      markGrokEntitlementDenied(input.stateDbPath);
      throw new GrokSubscriptionAuthError(
        "The connected Grok subscription is not authorized for xAI API access. Use the separate xAI API-key provider in Aithy, or upgrade the subscription.",
        "tier_denied",
      );
    }
    if (isTerminalTokenFailure(error)) {
      await deleteGrokSubscriptionTokens(input.botId, input.secrets);
      writeGrokSubscriptionMetadata(
        input.stateDbPath,
        metadata("needs_reauth", "Sign in with Grok again to reconnect this subscription."),
      );
      throw new GrokSubscriptionAuthError(
        "Sign in with Grok again to reconnect this subscription.",
        "needs_reauth",
      );
    }
    throw error;
  }
}

function assertUsableMetadata(metadata: GrokSubscriptionMetadata | null): void {
  if (metadata?.state === "needs_reauth") {
    throw new GrokSubscriptionAuthError(
      metadata.message || "Sign in with Grok again to reconnect this subscription.",
      "needs_reauth",
    );
  }
  if (metadata?.state === "tier_denied") {
    throw new GrokSubscriptionAuthError(
      metadata.message || "The connected Grok subscription is not authorized for xAI API access.",
      "tier_denied",
    );
  }
}

function missingAuthError(): GrokSubscriptionAuthError {
  return new GrokSubscriptionAuthError(
    "Sign in with Grok to connect a SuperGrok or X Premium+ subscription.",
    "disconnected",
  );
}

function metadata(
  state: GrokSubscriptionState,
  message: string,
): GrokSubscriptionMetadata {
  return {
    state,
    message,
    updatedAt: new Date().toISOString(),
  };
}
