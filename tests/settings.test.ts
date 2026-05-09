import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { isLoopbackRequest } from "../src/settings/localhost";
import {
  apiKeySecretName,
  readProviderApiKey,
  writeProviderApiKey,
  deleteProviderApiKey,
  type SecretStore,
} from "../src/settings/secrets";
import { applyRuntimeSettings, runtimeSandboxChanged } from "../src/settings/resolve";
import { SqliteSettingsStore } from "../src/settings/store";

describe("web settings", () => {
  test("persists runtime settings and UI preferences in metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-settings-"));
    const store = new SqliteSettingsStore(path.join(root, "state.db"));

    const saved = store.save({
      runtime: {
        aiProvider: "ollama",
        aiModel: "llama3.2",
        sandboxProvider: "disabled",
      },
      ui: {
        theme: "terminal-glow",
        colorMode: "dark",
        layout: "work",
        detailsDefault: true,
        lastActiveSessionId: "test-session",
      },
    });

    const loaded = new SqliteSettingsStore(path.join(root, "state.db")).load();
    expect(loaded.runtime).toEqual(saved.runtime);
    expect(loaded.ui.theme).toBe("terminal-glow");
    expect(loaded.ui.layout).toBe("work");
    expect(loaded.ui.detailsDefault).toBe(true);
  });

  test("merges persisted runtime settings into env config", () => {
    const base = loadConfig({
      AITHY_AI_MODEL: "gpt-test",
      OPENAI_API_KEY: "env-key",
    });
    const next = applyRuntimeSettings(base, {
      aiProvider: "openai",
      aiModel: "gpt-next",
      sandboxProvider: "disabled",
      sandboxImage: "ubuntu:24.04",
    });

    expect(next.aiModel).toBe("gpt-next");
    expect(next.aiApiKey).toBe("env-key");
    expect(next.sandboxProvider).toBe("disabled");
    expect(runtimeSandboxChanged(base, next)).toBe(true);
  });

  test("normalizes legacy mock sandbox settings to disabled", () => {
    const base = loadConfig({});
    const next = applyRuntimeSettings(base, {
      sandboxProvider: "mock" as any,
    });

    expect(next.sandboxProvider).toBe("disabled");
    expect(runtimeSandboxChanged(base, next)).toBe(true);
  });

  test("uses Bun.secrets compatible service and name fields", async () => {
    const fake = new MemorySecretStore();
    await writeProviderApiKey("openai", "sk-test", fake);

    expect(await readProviderApiKey("openai", fake)).toBe("sk-test");
    expect(fake.lastSet).toEqual({
      service: "com.aithy.local",
      name: apiKeySecretName("openai"),
      value: "sk-test",
    });
    expect(await deleteProviderApiKey("openai", fake)).toBe(true);
    expect(await readProviderApiKey("openai", fake)).toBeUndefined();
  });

  test("allows only localhost web mutations", () => {
    expect(isLoopbackRequest(new Request("http://127.0.0.1:3000/x"))).toBe(true);
    expect(isLoopbackRequest(new Request("http://localhost:3000/x", {
      headers: { origin: "http://localhost:3000" },
    }))).toBe(true);
    expect(isLoopbackRequest(new Request("http://0.0.0.0:3000/x"))).toBe(false);
    expect(isLoopbackRequest(new Request("http://127.0.0.1:3000/x", {
      headers: { origin: "https://example.com" },
    }))).toBe(false);
  });
});

class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();
  lastSet?: { service: string; name: string; value: string };

  async get(options: { service: string; name: string }): Promise<string | null> {
    return this.values.get(key(options)) ?? null;
  }

  async set(options: { service: string; name: string; value: string }): Promise<void> {
    this.lastSet = options;
    this.values.set(key(options), options.value);
  }

  async delete(options: { service: string; name: string }): Promise<boolean> {
    return this.values.delete(key(options));
  }
}

function key(options: { service: string; name: string }): string {
  return `${options.service}:${options.name}`;
}
