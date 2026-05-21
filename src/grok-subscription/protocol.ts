import { createHash, randomBytes } from "node:crypto";
import {
  GROK_SUBSCRIPTION_CLIENT_ID,
  GROK_SUBSCRIPTION_DISCOVERY_URL,
  GROK_SUBSCRIPTION_REFRESH_SKEW_MS,
  GROK_SUBSCRIPTION_SCOPE,
} from "./constants";
import type { GrokSubscriptionTokens } from "./types";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface GrokSubscriptionEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export class GrokSubscriptionHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "GrokSubscriptionHttpError";
  }
}

export function createPkceVerifier(): string {
  return base64Url(randomBytes(32));
}

export function createPkceChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function createLoginState(): string {
  return base64Url(randomBytes(24));
}

export async function discoverGrokSubscriptionEndpoints(
  fetchFn: FetchLike = fetch,
): Promise<GrokSubscriptionEndpoints> {
  const response = await fetchFn(GROK_SUBSCRIPTION_DISCOVERY_URL);
  const payload = await readJson(response);
  const authorizationEndpoint = stringField(payload, "authorization_endpoint");
  const tokenEndpoint = stringField(payload, "token_endpoint");
  assertXaiHttpsEndpoint(authorizationEndpoint);
  assertXaiHttpsEndpoint(tokenEndpoint);
  return { authorizationEndpoint, tokenEndpoint };
}

export function buildGrokSubscriptionAuthorizeUrl(input: {
  authorizationEndpoint: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", GROK_SUBSCRIPTION_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", GROK_SUBSCRIPTION_SCOPE);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("plan", "generic");
  url.searchParams.set("referrer", "aithy");
  return url.href;
}

export async function exchangeGrokSubscriptionCode(input: {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  codeChallenge: string;
  fetchFn?: FetchLike;
}): Promise<GrokSubscriptionTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: GROK_SUBSCRIPTION_CLIENT_ID,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  const payload = await postToken(input.tokenEndpoint, body, input.fetchFn);
  return tokenPayloadToTokens(payload);
}

export async function refreshGrokSubscriptionTokens(input: {
  tokenEndpoint: string;
  tokens: GrokSubscriptionTokens;
  fetchFn?: FetchLike;
}): Promise<GrokSubscriptionTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: GROK_SUBSCRIPTION_CLIENT_ID,
    refresh_token: input.tokens.refreshToken,
  });
  const payload = await postToken(input.tokenEndpoint, body, input.fetchFn);
  return tokenPayloadToTokens(payload, input.tokens.refreshToken);
}

export function tokensExpiring(
  tokens: GrokSubscriptionTokens,
  skewMs = GROK_SUBSCRIPTION_REFRESH_SKEW_MS,
): boolean {
  if (!tokens.expiresAt) return false;
  const expiresAt = Date.parse(tokens.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt - Date.now() <= skewMs;
}

export function isEntitlementFailure(error: unknown): boolean {
  return error instanceof GrokSubscriptionHttpError && error.status === 403;
}

export function isTerminalTokenFailure(error: unknown): boolean {
  if (!(error instanceof GrokSubscriptionHttpError)) return false;
  if (error.status === 400 || error.status === 401) return true;
  const body = error.body.toLowerCase();
  return body.includes("invalid_grant") || body.includes("revoked");
}

async function postToken(
  tokenEndpoint: string,
  body: URLSearchParams,
  fetchFn: FetchLike = fetch,
): Promise<Record<string, unknown>> {
  assertXaiHttpsEndpoint(tokenEndpoint);
  const response = await fetchFn(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return readJson(response);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    throw new GrokSubscriptionHttpError(
      grokSubscriptionHttpMessage(response.status, text),
      response.status,
      text,
    );
  }
  const parsed = text ? JSON.parse(text) : {};
  if (!isRecord(parsed)) throw new Error("Grok sign-in returned an unexpected response.");
  return parsed;
}

function tokenPayloadToTokens(
  payload: Record<string, unknown>,
  fallbackRefreshToken?: string,
): GrokSubscriptionTokens {
  const accessToken = stringField(payload, "access_token");
  const refreshToken = stringField(payload, "refresh_token", fallbackRefreshToken);
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : undefined;
  return {
    accessToken,
    refreshToken,
    idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "Bearer",
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    obtainedAt: new Date().toISOString(),
  };
}

function stringField(
  value: Record<string, unknown>,
  key: string,
  fallback?: string,
): string {
  const field = value[key];
  if (typeof field === "string" && field.trim()) return field;
  if (fallback) return fallback;
  throw new Error(`Grok sign-in response is missing ${key}.`);
}

function assertXaiHttpsEndpoint(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Grok sign-in endpoint must use https.");
  if (url.hostname !== "x.ai" && !url.hostname.endsWith(".x.ai")) {
    throw new Error("Grok sign-in endpoint must be hosted by xAI.");
  }
}

function grokSubscriptionHttpMessage(status: number, body: string): string {
  if (status === 403) {
    return "The connected Grok subscription is not authorized for xAI API access. Use the separate xAI API-key provider in Aithy, or upgrade the subscription.";
  }
  return `Grok sign-in request failed with HTTP ${status}${body ? `: ${body.slice(0, 300)}` : ""}`;
}

function base64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
