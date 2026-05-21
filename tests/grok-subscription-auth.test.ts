import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildGrokSubscriptionAuthorizeUrl,
  createPkceChallenge,
  createPkceVerifier,
  type FetchLike,
} from "../src/grok-subscription/protocol";
import {
  GrokSubscriptionAuthError,
  resolveGrokSubscriptionCredentials,
} from "../src/grok-subscription/credentials";
import {
  logoutGrokSubscription,
  validateGrokSubscriptionCallbackState,
} from "../src/grok-subscription/login";
import {
  grokSubscriptionStatus,
  readGrokSubscriptionTokens,
  writeGrokSubscriptionTokens,
} from "../src/grok-subscription/store";
import type { GrokSubscriptionTokens } from "../src/grok-subscription/types";
import type { SecretStore } from "../src/settings/secrets";

describe("Grok subscription auth", () => {
  test("builds a PKCE sign-in URL with public subscription copy elsewhere", () => {
    const verifier = createPkceVerifier();
    const url = new URL(buildGrokSubscriptionAuthorizeUrl({
      authorizationEndpoint: "https://auth.x.ai/authorize",
      redirectUri: "http://127.0.0.1:56121/callback",
      codeChallenge: createPkceChallenge(verifier),
      state: "state",
      nonce: "nonce",
    }));

    expect(url.hostname).toBe("auth.x.ai");
    expect(url.searchParams.get("client_id")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("api:access");
    expect(url.searchParams.get("referrer")).toBe("aithy");
  });

  test("validates callback state before accepting a browser sign-in", () => {
    expect(() => validateGrokSubscriptionCallbackState("expected", "expected")).not.toThrow();
    expect(() => validateGrokSubscriptionCallbackState("expected", "other")).toThrow(/state mismatch/);
    expect(() => validateGrokSubscriptionCallbackState("expected", null)).toThrow(/state mismatch/);
  });

  test("stores tokens in the bot secret namespace and reports connected status", async () => {
    const fx = await fixture();
    await writeGrokSubscriptionTokens(fx.botId, tokens(), fx.secrets);

    expect(await readGrokSubscriptionTokens(fx.botId, fx.secrets)).toMatchObject({
      accessToken: "access",
      refreshToken: "refresh",
    });
    expect((await grokSubscriptionStatus(fx.botId, fx.dbPath, fx.secrets)).connected).toBe(true);
  });

  test("refreshes once when concurrent callers share an expired token", async () => {
    const fx = await fixture();
    let tokenCalls = 0;
    await writeGrokSubscriptionTokens(fx.botId, {
      ...tokens(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }, fx.secrets);
    const fetchFn: FetchLike = async (url) => {
      if (String(url).includes(".well-known")) {
        return json({ authorization_endpoint: "https://auth.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" });
      }
      tokenCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return json({ access_token: "next-access", refresh_token: "next-refresh", expires_in: 3600 });
    };

    const [a, b] = await Promise.all([
      resolveGrokSubscriptionCredentials({ botId: fx.botId, stateDbPath: fx.dbPath, secrets: fx.secrets, fetchFn }),
      resolveGrokSubscriptionCredentials({ botId: fx.botId, stateDbPath: fx.dbPath, secrets: fx.secrets, fetchFn }),
    ]);

    expect(a.accessToken).toBe("next-access");
    expect(b.accessToken).toBe("next-access");
    expect(tokenCalls).toBe(1);
  });

  test("quarantines terminal refresh failures until the user signs in again", async () => {
    const fx = await fixture();
    await writeGrokSubscriptionTokens(fx.botId, {
      ...tokens(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }, fx.secrets);
    const fetchFn: FetchLike = async (url) => {
      if (String(url).includes(".well-known")) {
        return json({ authorization_endpoint: "https://auth.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" });
      }
      return json({ error: "invalid_grant" }, 400);
    };

    await expect(resolveGrokSubscriptionCredentials({
      botId: fx.botId,
      stateDbPath: fx.dbPath,
      secrets: fx.secrets,
      fetchFn,
    })).rejects.toThrow(/Sign in with Grok again/);
    expect(await readGrokSubscriptionTokens(fx.botId, fx.secrets)).toBeNull();
    expect(await grokSubscriptionStatus(fx.botId, fx.dbPath, fx.secrets)).toMatchObject({
      connected: false,
      state: "needs_reauth",
    });
  });

  test("marks entitlement failures without mentioning public credential fallbacks", async () => {
    const fx = await fixture();
    await writeGrokSubscriptionTokens(fx.botId, {
      ...tokens(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }, fx.secrets);
    const fetchFn: FetchLike = async (url) => {
      if (String(url).includes(".well-known")) {
        return json({ authorization_endpoint: "https://auth.x.ai/authorize", token_endpoint: "https://auth.x.ai/token" });
      }
      return json({ error: "forbidden" }, 403);
    };

    await expect(resolveGrokSubscriptionCredentials({
      botId: fx.botId,
      stateDbPath: fx.dbPath,
      secrets: fx.secrets,
      fetchFn,
    })).rejects.toBeInstanceOf(GrokSubscriptionAuthError);
    const status = await grokSubscriptionStatus(fx.botId, fx.dbPath, fx.secrets);
    expect(status.state).toBe("tier_denied");
    const apiKeyEnv = ["XAI", "API", "KEY"].join("_");
    const baseUrlEnv = ["XAI", "BASE", "URL"].join("_");
    expect(status.message).not.toContain(apiKeyEnv);
    expect(status.message).not.toContain(baseUrlEnv);
  });

  test("logout deletes subscription tokens", async () => {
    const fx = await fixture();
    await writeGrokSubscriptionTokens(fx.botId, tokens(), fx.secrets);

    const status = await logoutGrokSubscription({
      botId: fx.botId,
      stateDbPath: fx.dbPath,
      secrets: fx.secrets,
    });

    expect(status.connected).toBe(false);
    expect(await readGrokSubscriptionTokens(fx.botId, fx.secrets)).toBeNull();
  });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-grok-auth-"));
  return {
    botId: "test-bot",
    dbPath: path.join(root, "state.db"),
    secrets: new MemorySecretStore(),
  };
}

function tokens(): GrokSubscriptionTokens {
  return {
    accessToken: "access",
    refreshToken: "refresh",
    tokenType: "Bearer",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    obtainedAt: new Date().toISOString(),
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class MemorySecretStore implements SecretStore {
  values = new Map<string, string>();

  async get(options: { service: string; name: string }): Promise<string | null> {
    return this.values.get(key(options)) ?? null;
  }

  async set(options: { service: string; name: string; value: string }): Promise<void> {
    this.values.set(key(options), options.value);
  }

  async delete(options: { service: string; name: string }): Promise<boolean> {
    return this.values.delete(key(options));
  }
}

function key(options: { service: string; name: string }): string {
  return `${options.service}:${options.name}`;
}
