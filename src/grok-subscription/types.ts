export type GrokSubscriptionState =
  | "disconnected"
  | "connected"
  | "signing_in"
  | "needs_reauth"
  | "tier_denied"
  | "error";

export interface GrokSubscriptionTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  tokenType: string;
  expiresAt?: string;
  obtainedAt: string;
}

export interface GrokSubscriptionMetadata {
  state: GrokSubscriptionState;
  message?: string;
  updatedAt: string;
  lastConnectedAt?: string;
  expiresAt?: string;
}

export interface GrokSubscriptionStatus {
  connected: boolean;
  state: GrokSubscriptionState;
  message: string | null;
  updatedAt: string | null;
  lastConnectedAt: string | null;
  expiresAt: string | null;
}

export interface GrokSubscriptionCredentials {
  accessToken: string;
  expiresAt?: string;
}

