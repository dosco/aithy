import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { CUSTOM_OPENAI_PROVIDER } from "../src/agent/ai-providers";
import { meshInferenceProviderId, meshSearchProviderId } from "../src/mesh/types";
import { DEFAULT_LOCAL_AGENT_MODEL_ID, DEFAULT_LOCAL_EMBEDDING_MODEL, LOCAL_AI_PROVIDER } from "../src/local-inference/manifest";
import { loadConfig } from "../src/config/env";
import { SqliteMeshStore } from "../src/mesh/store";
import { resolveEffectiveConfig } from "../src/runtime/resolve-effective-config";
import { isLoopbackRequest } from "../src/settings/localhost";
import { aiProfileFingerprint, searchProfileFingerprint, validValidation } from "../src/settings/provider-profiles";
import {
  apiKeySecretName,
  oauthTokensSecretName,
  normalizePostedSecret,
  parallelApiKeySecretName,
  readParallelApiKey,
  readProviderApiKey,
  writeParallelApiKey,
  writeProviderApiKey,
  deleteParallelApiKey,
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
        systemBashEnabled: false,
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

  test("merges persisted runtime settings into base config", () => {
    const base = loadConfig({});
    const next = applyRuntimeSettings(base, {
      aiProvider: CUSTOM_OPENAI_PROVIDER,
      aiApiUrl: "https://api.example.test/v1",
      aiModel: "gpt-next",
      localInference: {
        contextSize: 131072,
        embeddingContextSize: 8192,
        modelsMax: 3,
        temperature: 1,
        topP: 0.8,
        thinkingMode: false,
      },
      sandboxProvider: "disabled",
      sandboxImage: "ubuntu:24.04",
      systemBashEnabled: false,
      parallelSearchMcpUrl: "https://search.example.test/mcp",
    });

    expect(next.aiProvider).toBe(CUSTOM_OPENAI_PROVIDER);
    expect(next.aiApiUrl).toBe("https://api.example.test/v1");
    expect(next.aiModel).toBe("gpt-next");
    expect(next.aiApiKey).toBeUndefined();
    expect(next.localInference).toMatchObject({
      contextSize: 131072,
      embeddingContextSize: 8192,
      modelsMax: 3,
      temperature: 1,
      topP: 0.8,
      thinkingMode: false,
    });
    expect(next.sandboxProvider).toBe("disabled");
    expect(next.systemBashEnabled).toBe(false);
    expect(next.parallelSearchMcpUrl).toBe("https://search.example.test/mcp");
    expect(runtimeSandboxChanged(base, next)).toBe(true);
  });

  test("restores provider-scoped model and URL settings when switching providers", () => {
    const base = loadConfig({});
    const next = applyRuntimeSettings(base, {
      aiProvider: CUSTOM_OPENAI_PROVIDER,
      aiProviderProfiles: {
        openai: { model: "gpt-openai" },
        [CUSTOM_OPENAI_PROVIDER]: {
          apiUrl: "https://api.example.test/v1",
          model: "custom-chat",
        },
      },
      searchProvider: "parallel",
      searchProviderProfiles: {
        parallel: {
          url: "https://search.example.test/mcp",
          mode: "api-key",
        },
      },
    });

    expect(next.aiProvider).toBe(CUSTOM_OPENAI_PROVIDER);
    expect(next.aiApiUrl).toBe("https://api.example.test/v1");
    expect(next.aiModel).toBe("custom-chat");
    expect(next.searchProvider).toBe("parallel");
    expect(next.parallelSearchMcpUrl).toBe("https://search.example.test/mcp");
  });

  test("migrates legacy runtime fields into provider-scoped profiles on load", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-settings-"));
    const dbPath = path.join(root, "state.db");
    const store = new SqliteSettingsStore(dbPath);
    store.save({
      runtime: {
        aiProvider: CUSTOM_OPENAI_PROVIDER,
        aiApiUrl: "https://api.example.test/v1",
        aiModel: "custom-chat",
        fastAiProvider: "openai",
        fastAiModel: "gpt-fast",
        parallelSearchMcpUrl: "https://search.example.test/mcp",
      },
    });

    const loaded = new SqliteSettingsStore(dbPath).load();
    expect(loaded.runtime.aiProviderProfiles?.[CUSTOM_OPENAI_PROVIDER]).toMatchObject({
      apiUrl: "https://api.example.test/v1",
      model: "custom-chat",
    });
    expect(loaded.runtime.aiProviderProfiles?.openai).toMatchObject({
      fastModel: "gpt-fast",
    });
    expect(loaded.runtime.searchProviderProfiles?.parallel).toMatchObject({
      url: "https://search.example.test/mcp",
    });
  });

  test("validation fingerprints change with config and secret versions", () => {
    const llm = aiProfileFingerprint({
      provider: "openai",
      model: "gpt-a",
      secretVersion: 1,
    });
    expect(aiProfileFingerprint({
      provider: "openai",
      model: "gpt-b",
      secretVersion: 1,
    })).not.toBe(llm);
    expect(aiProfileFingerprint({
      provider: "openai",
      model: "gpt-a",
      secretVersion: 2,
    })).not.toBe(llm);

    const search = searchProfileFingerprint({
      provider: "parallel",
      url: "https://search.example.test/mcp",
      mode: "api-key",
      secretVersion: 1,
    });
    expect(searchProfileFingerprint({
      provider: "parallel",
      url: "https://search.example.test/mcp",
      mode: "anonymous",
      secretVersion: 1,
    })).not.toBe(search);
  });

  test("marks stale provider validation unknown when profile fields change", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-settings-"));
    const store = new SqliteSettingsStore(path.join(root, "state.db"));
    const saved = store.save({
      runtime: {
        aiProviderProfiles: {
          openai: {
            model: "gpt-new",
            secretVersion: 1,
            validation: validValidation(aiProfileFingerprint({
              provider: "openai",
              model: "gpt-old",
              secretVersion: 1,
            })),
          },
        },
        searchProviderProfiles: {
          parallel: {
            url: "https://search-new.example/mcp",
            mode: "anonymous",
            validation: validValidation(searchProfileFingerprint({
              provider: "parallel",
              url: "https://search-old.example/mcp",
              mode: "anonymous",
            })),
          },
        },
      },
    });

    expect(saved.runtime.aiProviderProfiles?.openai.validation?.status).toBe("unknown");
    expect(saved.runtime.searchProviderProfiles?.parallel.validation?.status).toBe("unknown");
  });

  test("uses local agent model for Local provider without requiring a key", () => {
    const next = applyRuntimeSettings(loadConfig({}), {
      aiProvider: LOCAL_AI_PROVIDER,
      localAgentModel: "hf:example/model:test.gguf",
    });

    expect(next.aiProvider).toBe(LOCAL_AI_PROVIDER);
    expect(next.aiModel).toBe("hf:example/model:test.gguf");
    expect(next.localAgentModel).toBe("hf:example/model:test.gguf");
    expect(next.aiApiKey).toBeUndefined();
  });

  test("keeps family Aithy selections as provider ids without persisting proxy URLs", () => {
    const provider = meshInferenceProviderId("gpu-1");
    const next = applyRuntimeSettings(loadConfig({}), {
      aiProvider: provider,
      aiApiUrl: "http://127.0.0.1:49321/mesh/proxy/gpu-1/inference/default/v1",
      aiModel: "aithy-local-chat",
      fastAiProvider: provider,
      fastAiApiUrl: "http://127.0.0.1:49321/mesh/proxy/gpu-1/inference/default/v1",
      fastAiModel: "aithy-local-chat",
    });

    expect(next.aiProvider).toBe(provider);
    expect(next.aiApiUrl).toBeUndefined();
    expect(next.aiModel).toBe("aithy-local-chat");
    expect(next.fastAiProvider).toBe(provider);
    expect(next.fastAiApiUrl).toBeUndefined();
  });

  test("resolves family proxy URLs from the current mesh proxy port", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-settings-"));
    const base = { ...loadConfig({}), stateDbPath: path.join(root, "state.db") };
    const store = new SqliteMeshStore(base.stateDbPath);
    store.saveProxyPort(49321);
    store.close();
    const aiProvider = meshInferenceProviderId("gpu-1", "openai.primary");
    const searchProvider = meshSearchProviderId("gpu-1", "parallel.search") as `mesh:${string}:search:${string}`;
    const next = await resolveEffectiveConfig(base, {
      runtime: { aiProvider, aiModel: "aithy-local-chat", searchProvider },
      ui: { theme: "paper", colorMode: "system", layout: "chat", detailsDefault: false, lastActiveSessionId: null },
      updatedAt: new Date().toISOString(),
    });

    expect(next.aiApiUrl).toBe("http://127.0.0.1:49321/mesh/proxy/gpu-1/inference/openai.primary/v1");
    expect(next.searchApiUrl).toBe("http://127.0.0.1:49321/mesh/proxy/gpu-1/search/parallel.search");
  });

  test("falls back to the managed local model when a local model id is invalid", () => {
    const next = applyRuntimeSettings(loadConfig({}), {
      aiProvider: LOCAL_AI_PROVIDER,
      localAgentModel: "not-a-local-id",
    });

    expect(next.aiModel).toBe(DEFAULT_LOCAL_AGENT_MODEL_ID);
  });

  test("falls back when a managed non-chat local model is selected for chat", () => {
    const next = applyRuntimeSettings(loadConfig({}), {
      aiProvider: LOCAL_AI_PROVIDER,
      localAgentModel: DEFAULT_LOCAL_EMBEDDING_MODEL.id,
    });

    expect(next.aiModel).toBe(DEFAULT_LOCAL_AGENT_MODEL_ID);
  });

  test("clears custom OpenAI base URL when provider changes away", () => {
    const base = {
      ...loadConfig({}),
      aiProvider: CUSTOM_OPENAI_PROVIDER,
      aiApiUrl: "https://api.example.test/v1",
    };
    const next = applyRuntimeSettings(base, {
      aiProvider: "openai",
    });

    expect(next.aiProvider).toBe("openai");
    expect(next.aiApiUrl).toBeUndefined();
  });

  test("merges Parallel search key overrides without requiring one", () => {
    const base = loadConfig();
    const anonymous = applyRuntimeSettings(base, {
      parallelApiKey: null,
    }, undefined, undefined, null);
    const keyed = applyRuntimeSettings(base, {}, undefined, undefined, "pk-settings");

    expect(applyRuntimeSettings(loadConfig(), {}).parallelApiKey).toBeUndefined();
    expect(anonymous.parallelApiKey).toBeUndefined();
    expect(keyed.parallelApiKey).toBe("pk-settings");
  });

  test("clear model settings remove persisted model", () => {
    const base = { ...loadConfig({}), aiModel: "gpt-test" };
    const next = applyRuntimeSettings(base, {
      aiProvider: "openai",
      aiModel: null,
    });

    expect(next.aiModel).toBeUndefined();
  });

  test("clear api key settings remove stored key", () => {
    const base = { ...loadConfig({}), aiApiKey: "stored-key" };
    const next = applyRuntimeSettings(base, {
      aiApiKey: null,
    }, null);

    expect(next.aiApiKey).toBeUndefined();
  });

  test("new api key patch clears persisted clear-key override", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-settings-"));
    const dbPath = path.join(root, "state.db");
    const store = new SqliteSettingsStore(dbPath);
    store.save({ runtime: { aiApiKey: null } });

    const saved = store.save({
      runtime: {
        aiProvider: "openai",
        aiModel: "gpt-test",
        aiApiKey: undefined,
      },
    });
    const base = loadConfig({});
    const next = applyRuntimeSettings(base, saved.runtime, "sk-test");

    expect(next.aiApiKey).toBe("sk-test");
    expect(
      new SqliteSettingsStore(dbPath).load().runtime.aiApiKey,
    ).toBeUndefined();
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
    await writeProviderApiKey("openai", "sk-test", "alpha", fake);

    expect(await readProviderApiKey("openai", "alpha", fake)).toBe("sk-test");
    expect(fake.lastSet).toEqual({
      service: "aithy.alpha",
      name: apiKeySecretName("openai"),
      value: "sk-test",
    });
    expect(await deleteProviderApiKey("openai", "alpha", fake)).toBe(true);
    expect(await readProviderApiKey("openai", "alpha", fake)).toBeUndefined();
  });

  test("stores Parallel API keys in the bot secret namespace", async () => {
    const fake = new MemorySecretStore();
    await writeParallelApiKey("pk-test", "alpha", fake);

    expect(await readParallelApiKey("alpha", fake)).toBe("pk-test");
    expect(fake.lastSet).toEqual({
      service: "aithy.alpha",
      name: parallelApiKeySecretName(),
      value: "pk-test",
    });
    expect(await deleteParallelApiKey("alpha", fake)).toBe(true);
    expect(await readParallelApiKey("alpha", fake)).toBeUndefined();
  });

  test("uses Aithy service-prefixed secret names", () => {
    expect(apiKeySecretName("openai")).toBe("aithy.llm.openai.api-key");
    expect(parallelApiKeySecretName()).toBe("aithy.search.parallel.api-key");
    expect(oauthTokensSecretName("xai-grok-subscription")).toBe("aithy.oauth.xai-grok-subscription.tokens");
  });

  test("reads legacy shared secrets after bot namespace migration", async () => {
    const fake = new MemorySecretStore();
    await fake.set({
      service: "com.aithy.local",
      name: apiKeySecretName("openai"),
      value: "sk-legacy",
    });

    expect(await readProviderApiKey("openai", "alpha", fake)).toBe("sk-legacy");
  });

  test("treats unavailable secret backends as unconfigured", async () => {
    const fake = {
      get: async () => {
        throw new Error("secret backend unavailable");
      },
      set: async () => undefined,
      delete: async () => false,
    };
    expect(await readProviderApiKey("openai", "alpha", fake)).toBeUndefined();
  });

  test("normalizes posted secrets by trimming whitespace and wrapping quotes", () => {
    expect(normalizePostedSecret("  'sk-test'  ")).toBe("sk-test");
    expect(normalizePostedSecret('  "  sk-test  "  ')).toBe("sk-test");
    expect(normalizePostedSecret("sk-test")).toBe("sk-test");
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
