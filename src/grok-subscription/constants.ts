export const GROK_SUBSCRIPTION_API_BASE_URL = "https://api.x.ai/v1";
export const GROK_SUBSCRIPTION_AUTH_ISSUER = "https://auth.x.ai";
export const GROK_SUBSCRIPTION_DISCOVERY_URL =
  `${GROK_SUBSCRIPTION_AUTH_ISSUER}/.well-known/openid-configuration`;
export const GROK_SUBSCRIPTION_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_SUBSCRIPTION_SCOPE =
  "openid profile email offline_access grok-cli:access api:access";
export const GROK_SUBSCRIPTION_REDIRECT_HOST = "127.0.0.1";
export const GROK_SUBSCRIPTION_REDIRECT_PORT = 56121;
export const GROK_SUBSCRIPTION_REDIRECT_PATH = "/callback";
export const GROK_SUBSCRIPTION_REFRESH_SKEW_MS = 120_000;
export const GROK_SUBSCRIPTION_LOGIN_TIMEOUT_MS = 180_000;

