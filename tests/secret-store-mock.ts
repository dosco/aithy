import type { SecretStore } from "../src/settings/secrets";

export class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();
  lastSet?: { service: string; name: string; value: string };

  constructor(seed: Array<{ service: string; name: string; value: string }> = []) {
    for (const item of seed) this.values.set(secretKey(item), item.value);
  }

  async get(options: { service: string; name: string }): Promise<string | null> {
    return this.values.get(secretKey(options)) ?? null;
  }

  async set(options: { service: string; name: string; value: string }): Promise<void> {
    this.lastSet = options;
    this.values.set(secretKey(options), options.value);
  }

  async delete(options: { service: string; name: string }): Promise<boolean> {
    return this.values.delete(secretKey(options));
  }
}

function secretKey(options: { service: string; name: string }): string {
  return `${options.service}:${options.name}`;
}
