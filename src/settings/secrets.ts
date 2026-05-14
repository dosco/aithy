export interface SecretStore {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

const legacyAithySecretService = "com.aithy.local";
const SECRET_TIMEOUT_MS = 15_000;

export const BunSecretStore: SecretStore = {
  get: (options) =>
    withSecretTimeout(Bun.secrets.get(options), `Reading ${options.name} from secure storage`),
  set: (options) =>
    withSecretTimeout(Bun.secrets.set(options), `Saving ${options.name} to secure storage`),
  delete: (options) =>
    withSecretTimeout(Bun.secrets.delete(options), `Deleting ${options.name} from secure storage`),
};

export function apiKeySecretName(provider: string): string {
  return `ai.${provider}.api-key`;
}

export function parallelApiKeySecretName(): string {
  return "parallel.search-api-key";
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
  return (await safeSecretGet(secrets, {
    service: aithySecretService(botId),
    name,
  })) ?? (await safeSecretGet(secrets, {
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

export async function readParallelApiKey(
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<string | undefined> {
  return (await safeSecretGet(secrets, {
    service: aithySecretService(botId),
    name: parallelApiKeySecretName(),
  })) ?? undefined;
}

export async function writeParallelApiKey(
  value: string,
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<void> {
  const service = aithySecretService(botId);
  const name = parallelApiKeySecretName();
  await secrets.set({ service, name, value });
  const saved = await secrets.get({ service, name });
  if (saved !== value) {
    throw new Error("Could not read back the saved Parallel API key from Bun.secrets.");
  }
}

export async function deleteParallelApiKey(
  botId: string,
  secrets: SecretStore = BunSecretStore,
): Promise<boolean> {
  return secrets.delete({
    service: aithySecretService(botId),
    name: parallelApiKeySecretName(),
  });
}

function isQuoted(value: string): boolean {
  if (value.length < 2) return false;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'");
}

async function safeSecretGet(
  secrets: SecretStore,
  options: { service: string; name: string },
): Promise<string | null> {
  try {
    return await secrets.get(options);
  } catch {
    return null;
  }
}

async function withSecretTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${SECRET_TIMEOUT_MS / 1000} seconds.`)),
          SECRET_TIMEOUT_MS,
        );
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
