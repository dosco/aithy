import { aithySecretService } from "./types";

export interface SecretStore {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

export const BunSecretStore: SecretStore = {
  get: (options) => Bun.secrets.get(options),
  set: (options) => Bun.secrets.set(options),
  delete: (options) => Bun.secrets.delete(options),
};

export function apiKeySecretName(provider: string): string {
  return `ai.${provider}.api-key`;
}

export async function readProviderApiKey(
  provider: string,
  secrets: SecretStore = BunSecretStore,
): Promise<string | undefined> {
  return (await secrets.get({
    service: aithySecretService,
    name: apiKeySecretName(provider),
  })) ?? undefined;
}

export async function writeProviderApiKey(
  provider: string,
  value: string,
  secrets: SecretStore = BunSecretStore,
): Promise<void> {
  await secrets.set({
    service: aithySecretService,
    name: apiKeySecretName(provider),
    value,
  });
}

export async function deleteProviderApiKey(
  provider: string,
  secrets: SecretStore = BunSecretStore,
): Promise<boolean> {
  return secrets.delete({
    service: aithySecretService,
    name: apiKeySecretName(provider),
  });
}
