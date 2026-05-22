import type { AppConfig } from "../../src/config/env";
import { AX_AI_PROVIDERS } from "../../src/agent/ai-providers";
import { providerRequiresApiKey } from "../../src/config/validate";
import { grokSubscriptionStatus as readGrokSubscriptionStatus } from "../../src/grok-subscription/store";
import { activeSearchProvider, aiProfileFor, searchProfileFor } from "../../src/settings/provider-profiles";
import { readProviderApiKey, readSearchApiKey } from "../../src/settings/secrets";
import type { StoredSettings } from "../../src/settings/types";
import type { GrokSubscriptionStatusDto, ParallelSearchStatusDto, SecretStatusDto } from "./dto-types";

export async function secretStatus(
  config: AppConfig,
  settings?: StoredSettings,
): Promise<SecretStatusDto> {
  if (settings?.runtime.aiApiKey === null) {
    return { provider: config.aiProvider, configured: false, source: null };
  }
  return secretStatusForProvider(config.aiProvider, config.botId, settings);
}

export async function secretStatusForProvider(
  provider: string,
  botId: string,
  settings?: StoredSettings,
): Promise<SecretStatusDto> {
  const secret = await readProviderApiKey(provider, botId);
  return {
    provider,
    configured: Boolean(secret),
    source: secret ? "bun.secrets" : null,
    validation: validationDto(secret || !providerRequiresApiKey(provider)
      ? settings ? aiProfileFor(settings.runtime, provider).validation : undefined
      : { status: "unknown", message: "API key required before validation." }),
  };
}

export async function providerSecretStatuses(
  config: AppConfig,
  settings: StoredSettings,
): Promise<Record<string, SecretStatusDto>> {
  const providers = new Set<string>([
    ...AX_AI_PROVIDERS,
    config.aiProvider,
    config.fastAiProvider,
    ...Object.keys(settings.runtime.aiProviderProfiles ?? {}),
  ].filter((provider): provider is string => Boolean(provider)));
  const statuses = await Promise.all(
    [...providers].map((provider) => secretStatusForProvider(provider, config.botId, settings)),
  );
  return Object.fromEntries(statuses.map((status) => [status.provider, status]));
}

export async function parallelSearchStatus(
  config: AppConfig,
  settings?: StoredSettings,
): Promise<ParallelSearchStatusDto> {
  const provider = settings ? activeSearchProvider(settings.runtime) : config.searchProvider ?? "parallel";
  const profile = settings ? searchProfileFor(settings.runtime, provider) : undefined;
  const grok = await grokSubscriptionStatusDto(config);
  if (provider === "grok-subscription") {
    return {
      provider: "grok-subscription",
      configured: grok.connected,
      source: grok.connected ? "bun.secrets" : null,
      mode: "grok-subscription",
      url: config.parallelSearchMcpUrl,
      validation: validationDto(profile?.validation),
    };
  }
  if (settings?.runtime.parallelApiKey === null) {
    return {
      provider: "parallel",
      configured: false,
      source: null,
      mode: "anonymous",
      url: config.parallelSearchMcpUrl,
      validation: validationDto(profile?.validation),
    };
  }
  const stored = await readSearchApiKey("parallel", config.botId);
  const source = stored ? "bun.secrets" : null;
  return {
    provider: "parallel",
    configured: Boolean(source),
    source,
    mode: source ? "api-key" : "anonymous",
    url: config.parallelSearchMcpUrl,
    validation: validationDto(profile?.validation),
  };
}

export async function grokSubscriptionStatusDto(
  config: AppConfig,
): Promise<GrokSubscriptionStatusDto> {
  return readGrokSubscriptionStatus(config.botId, config.stateDbPath);
}

function validationDto(validation: SecretStatusDto["validation"] | undefined): SecretStatusDto["validation"] {
  if (!validation) return { status: "unknown" };
  return {
    status: validation.status,
    ...(validation.message !== undefined ? { message: validation.message } : {}),
    ...(validation.validatedAt ? { validatedAt: validation.validatedAt } : {}),
  };
}
