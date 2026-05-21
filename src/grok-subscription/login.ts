import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  GROK_SUBSCRIPTION_LOGIN_TIMEOUT_MS,
  GROK_SUBSCRIPTION_REDIRECT_HOST,
  GROK_SUBSCRIPTION_REDIRECT_PATH,
  GROK_SUBSCRIPTION_REDIRECT_PORT,
} from "./constants";
import {
  buildGrokSubscriptionAuthorizeUrl,
  createLoginState,
  createPkceChallenge,
  createPkceVerifier,
  discoverGrokSubscriptionEndpoints,
  exchangeGrokSubscriptionCode,
  type FetchLike,
} from "./protocol";
import { markGrokSubscriptionConnected } from "./credentials";
import {
  deleteGrokSubscriptionTokens,
  grokSubscriptionStatus,
  writeGrokSubscriptionMetadata,
  writeGrokSubscriptionTokens,
} from "./store";
import type { GrokSubscriptionState, GrokSubscriptionStatus } from "./types";
import type { SecretStore } from "../settings/secrets";

export interface GrokSubscriptionLoginStart {
  loginId: string;
  authorizeUrl: string;
  redirectUri: string;
  status: GrokSubscriptionStatus;
}

export interface GrokSubscriptionLoginPoll {
  loginId: string;
  state: GrokSubscriptionState;
  message: string;
  status: GrokSubscriptionStatus;
}

interface PendingLogin {
  botId: string;
  stateDbPath: string;
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  tokenEndpoint: string;
  server: Server;
  timer: Timer;
  result: {
    state: GrokSubscriptionState;
    message: string;
  };
  secrets?: SecretStore;
  fetchFn?: FetchLike;
}

const pendingLogins = new Map<string, PendingLogin>();
const finishedLogins = new Map<string, {
  botId: string;
  stateDbPath: string;
  secrets?: SecretStore;
  result: PendingLogin["result"];
}>();

export async function startGrokSubscriptionLogin(input: {
  botId: string;
  stateDbPath: string;
  secrets?: SecretStore;
  fetchFn?: FetchLike;
}): Promise<GrokSubscriptionLoginStart> {
  const loginId = crypto.randomUUID();
  const endpoints = await discoverGrokSubscriptionEndpoints(input.fetchFn);
  const state = createLoginState();
  const nonce = createLoginState();
  const codeVerifier = createPkceVerifier();
  const codeChallenge = createPkceChallenge(codeVerifier);
  const redirectUri = `http://${GROK_SUBSCRIPTION_REDIRECT_HOST}:${GROK_SUBSCRIPTION_REDIRECT_PORT}${GROK_SUBSCRIPTION_REDIRECT_PATH}`;

  const server = createServer((req, res) => {
    void handleCallback(loginId, req, res);
  });
  await listen(server, GROK_SUBSCRIPTION_REDIRECT_PORT, GROK_SUBSCRIPTION_REDIRECT_HOST);

  const timer = setTimeout(() => {
    const login = pendingLogins.get(loginId);
    if (!login) return;
    login.result = {
      state: "error",
      message: "Grok sign-in timed out. Start sign-in again when you are ready.",
    };
    cleanupLogin(loginId);
  }, GROK_SUBSCRIPTION_LOGIN_TIMEOUT_MS);
  timer.unref();

  pendingLogins.set(loginId, {
    botId: input.botId,
    stateDbPath: input.stateDbPath,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    tokenEndpoint: endpoints.tokenEndpoint,
    server,
    timer,
    result: {
      state: "signing_in",
      message: "Waiting for Grok sign-in.",
    },
    secrets: input.secrets,
    fetchFn: input.fetchFn,
  });
  writeGrokSubscriptionMetadata(input.stateDbPath, {
    state: "signing_in",
    message: "Waiting for Grok sign-in.",
    updatedAt: new Date().toISOString(),
  });

  return {
    loginId,
    authorizeUrl: buildGrokSubscriptionAuthorizeUrl({
      authorizationEndpoint: endpoints.authorizationEndpoint,
      redirectUri,
      codeChallenge,
      state,
      nonce,
    }),
    redirectUri,
    status: await grokSubscriptionStatus(input.botId, input.stateDbPath, input.secrets),
  };
}

export async function pollGrokSubscriptionLogin(
  loginId: string,
): Promise<GrokSubscriptionLoginPoll> {
  const login = pendingLogins.get(loginId);
  const finished = finishedLogins.get(loginId);
  if (finished) {
    return {
      loginId,
      state: finished.result.state,
      message: finished.result.message,
      status: await grokSubscriptionStatus(finished.botId, finished.stateDbPath, finished.secrets),
    };
  }
  if (!login) {
    return {
      loginId,
      state: "error",
      message: "Grok sign-in session is no longer active.",
      status: {
        connected: false,
        state: "error",
        message: "Grok sign-in session is no longer active.",
        updatedAt: null,
        lastConnectedAt: null,
        expiresAt: null,
      },
    };
  }
  return {
    loginId,
    state: login.result.state,
    message: login.result.message,
    status: await grokSubscriptionStatus(login.botId, login.stateDbPath, login.secrets),
  };
}

export async function logoutGrokSubscription(input: {
  botId: string;
  stateDbPath: string;
  secrets?: SecretStore;
}): Promise<GrokSubscriptionStatus> {
  await deleteGrokSubscriptionTokens(input.botId, input.secrets);
  writeGrokSubscriptionMetadata(input.stateDbPath, {
    state: "disconnected",
    message: "Signed out of Grok.",
    updatedAt: new Date().toISOString(),
  });
  return grokSubscriptionStatus(input.botId, input.stateDbPath, input.secrets);
}

async function handleCallback(
  loginId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const login = pendingLogins.get(loginId);
  if (!login) {
    sendCallbackPage(response, 410, "Grok sign-in is no longer active.");
    return;
  }

  const url = new URL(request.url ?? "/", login.redirectUri);
  if (url.pathname !== GROK_SUBSCRIPTION_REDIRECT_PATH) {
    sendCallbackPage(response, 404, "Unknown Grok sign-in callback.");
    return;
  }
  try {
    validateGrokSubscriptionCallbackState(login.state, url.searchParams.get("state"));
  } catch {
    login.result = {
      state: "error",
      message: "Grok sign-in could not be verified. Start sign-in again.",
    };
    writeGrokSubscriptionMetadata(login.stateDbPath, {
      state: "error",
      message: login.result.message,
      updatedAt: new Date().toISOString(),
    });
    cleanupLogin(loginId);
    sendCallbackPage(response, 400, login.result.message);
    return;
  }

  const code = url.searchParams.get("code");
  const remoteError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (!code) {
    login.result = {
      state: "error",
      message: remoteError || "Grok sign-in did not return an authorization code.",
    };
    writeGrokSubscriptionMetadata(login.stateDbPath, {
      state: "error",
      message: login.result.message,
      updatedAt: new Date().toISOString(),
    });
    cleanupLogin(loginId);
    sendCallbackPage(response, 400, login.result.message);
    return;
  }

  try {
    const tokens = await exchangeGrokSubscriptionCode({
      tokenEndpoint: login.tokenEndpoint,
      code,
      redirectUri: login.redirectUri,
      codeVerifier: login.codeVerifier,
      codeChallenge: login.codeChallenge,
      fetchFn: login.fetchFn,
    });
    await writeGrokSubscriptionTokens(login.botId, tokens, login.secrets);
    markGrokSubscriptionConnected(login.stateDbPath, tokens);
    login.result = { state: "connected", message: "Grok subscription connected." };
    sendCallbackPage(response, 200, "Grok subscription connected. You can return to Aithy.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Grok sign-in failed.";
    login.result = { state: "error", message };
    writeGrokSubscriptionMetadata(login.stateDbPath, {
      state: "error",
      message,
      updatedAt: new Date().toISOString(),
    });
    sendCallbackPage(response, 500, message);
  } finally {
    cleanupLogin(loginId);
  }
}

function sendCallbackPage(
  response: ServerResponse,
  status: number,
  message: string,
): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><title>Aithy Grok Sign-in</title><p>${escapeHtml(message)}</p>`);
}

function cleanupLogin(loginId: string): void {
  const login = pendingLogins.get(loginId);
  if (!login) return;
  clearTimeout(login.timer);
  login.server.close();
  finishedLogins.set(loginId, {
    botId: login.botId,
    stateDbPath: login.stateDbPath,
    secrets: login.secrets,
    result: login.result,
  });
  setTimeout(() => finishedLogins.delete(loginId), 60_000).unref();
  pendingLogins.delete(loginId);
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function validateGrokSubscriptionCallbackState(
  expected: string,
  actual: string | null,
): void {
  if (actual !== expected) throw new Error("Grok sign-in state mismatch.");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
