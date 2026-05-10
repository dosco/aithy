export interface SecretStore {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

const legacyAithySecretService = "com.aithy.local";

export const BunSecretStore: SecretStore = {
  get: (options) => Bun.secrets.get(options),
  set: (options) => Bun.secrets.set(options),
  delete: (options) => Bun.secrets.delete(options),
};

export function apiKeySecretName(provider: string): string {
  return `ai.${provider}.api-key`;
}

export function aithySecretService(botId: string): string {
  return `aithy.${botId}`;
}

export function normalizePostedSecret(value: string | undefined | null): string | undefined {
  let next = value?.trim();
  while (next && isQuoted(next)) {
    next = next.slice(1, -1).trim();
  }
  return next || undefined;
}

export async function readProviderApiKey(
  provider: string,
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<string | undefined> {
  const name = apiKeySecretName(provider);
  return (await secrets.get({
    service: aithySecretService(botId),
    name,
  })) ?? (await secrets.get({
    service: legacyAithySecretService,
    name,
  })) ?? undefined;
}

export async function writeProviderApiKey(
  provider: string,
  value: string,
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<void> {
  const service = aithySecretService(botId);
  const name = apiKeySecretName(provider);
  await secrets.set({
    service,
    name,
    value,
  });
  const saved = await secrets.get({ service, name });
  if (saved !== value) {
    throw new Error("Could not read back the saved API key from Bun.secrets.");
  }
}

export async function deleteProviderApiKey(
  provider: string,
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<boolean> {
  const name = apiKeySecretName(provider);
  const next = await secrets.delete({
    service: aithySecretService(botId),
    name,
  });
  const legacy = await secrets.delete({
    service: legacyAithySecretService,
    name,
  });
  return next || legacy;
}

function isQuoted(value: string): boolean {
  if (value.length < 2) return false;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'");
}
