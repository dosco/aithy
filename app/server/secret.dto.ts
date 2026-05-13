import type { AppConfig } from "../../src/config/env";
import { readProviderApiKey } from "../../src/settings/secrets";
import type { StoredSettings } from "../../src/settings/types";
import type { SecretStatusDto } from "./dto-types";

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
