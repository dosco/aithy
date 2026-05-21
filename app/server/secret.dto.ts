import type { AppConfig } from "../../src/config/env";
import { grokSubscriptionStatus as readGrokSubscriptionStatus } from "../../src/grok-subscription/store";
import { readParallelApiKey, readProviderApiKey } from "../../src/settings/secrets";
import type { StoredSettings } from "../../src/settings/types";
import type { GrokSubscriptionStatusDto, ParallelSearchStatusDto, SecretStatusDto } from "./dto-types";

export async function secretStatus(
  config: AppConfig,
  settings?: StoredSettings,
): Promise<SecretStatusDto> {
  if (settings?.runtime.aiApiKey === null) {
    return { provider: config.aiProvider, configured: false, source: null };
  }
  return secretStatusForProvider(config.aiProvider, config.botId);
}

export async function secretStatusForProvider(
  provider: string,
  botId: string,
): Promise<SecretStatusDto> {
  const secret = await readProviderApiKey(provider, botId);
  return {
    provider,
    configured: Boolean(secret),
    source: secret ? "bun.secrets" : null,
  };
}

export async function parallelSearchStatus(
  config: AppConfig,
  settings?: StoredSettings,
): Promise<ParallelSearchStatusDto> {
  const grok = await grokSubscriptionStatusDto(config);
  if (grok.connected) {
    return {
      provider: "grok-subscription",
      configured: true,
      source: "bun.secrets",
      mode: "grok-subscription",
      url: config.parallelSearchMcpUrl,
    };
  }
  if (settings?.runtime.parallelApiKey === null) {
    return {
      provider: "parallel",
      configured: false,
      source: null,
      mode: "anonymous",
      url: config.parallelSearchMcpUrl,
    };
  }
  const stored = await readParallelApiKey(config.botId);
  const source = stored ? "bun.secrets" : null;
  return {
    provider: "parallel",
    configured: Boolean(source),
    source,
    mode: source ? "api-key" : "anonymous",
    url: config.parallelSearchMcpUrl,
  };
}

export async function grokSubscriptionStatusDto(
  config: AppConfig,
): Promise<GrokSubscriptionStatusDto> {
  return readGrokSubscriptionStatus(config.botId, config.stateDbPath);
}
