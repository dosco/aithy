import { describe, expect, test } from "bun:test";
import { CUSTOM_OPENAI_PROVIDER } from "../src/agent/ai-providers";
import { loadConfig } from "../src/config/env";
import {
  localMeshLiveCatalog,
  resolveMeshInferenceService,
  resolveMeshSearchService,
} from "../src/mesh/catalog";
import { meshInferenceProviderId } from "../src/mesh/types";
import { validValidation, validationNotRequired } from "../src/settings/provider-profiles";
import { apiKeySecretName, aithySecretService } from "../src/settings/secrets";
import type { RuntimeSettings } from "../src/settings/types";
import { MemorySecretStore } from "./secret-store-mock";

describe("mesh live catalog", () => {
  test("publishes metadata-only validated local LLM and search services", async () => {
    const config = {
      ...loadConfig(),
      aiProvider: CUSTOM_OPENAI_PROVIDER,
      aiApiKey: "sk-very-private",
      parallelSearchMcpUrl: "https://search.private.example/mcp",
    };
    const settings: RuntimeSettings = {
      aiProviderProfiles: {
        [CUSTOM_OPENAI_PROVIDER]: {
          apiUrl: "https://llm.private.example/v1",
          model: "local-slot-model",
          validation: validValidation("llm-fingerprint"),
        },
      },
      searchProviderProfiles: {
        parallel: {
          url: "https://search.private.example/mcp",
          mode: "anonymous",
          validation: validValidation("search-fingerprint"),
        },
      },
    };

    const catalog = await localMeshLiveCatalog({
      config,
      settings,
      sharing: { inference: true, search: true },
      secrets: new MemorySecretStore(),
    });
    expect(catalog.inference.map((service) => service.id)).toEqual(["custom-openai.primary"]);
    expect(catalog.search.map((service) => service.id)).toEqual(["parallel.search"]);
    expect(catalog.inference[0]?.models).toEqual([{ id: "local-slot-model", label: "local-slot-model" }]);
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain("sk-very-private");
    expect(serialized).not.toContain("llm.private.example");
    expect(serialized).not.toContain("search.private.example");
  });

  test("excludes mesh, unvalidated, and missing-secret profiles", async () => {
    const config = { ...loadConfig(), aiProvider: "openai", aiApiKey: undefined };
    const settings: RuntimeSettings = {
      aiProviderProfiles: {
        openai: { model: "gpt-4.1", validation: validValidation("fp") },
        [meshInferenceProviderId("peer-1", "openai.primary")]: {
          model: "remote-model",
          validation: validValidation("mesh-fp"),
        },
        anthropic: { model: "claude", validation: { status: "unknown" } },
      },
    };
    const catalog = await localMeshLiveCatalog({
      config,
      settings,
      sharing: { inference: true, search: true },
      secrets: new MemorySecretStore(),
    });
    expect(catalog.inference).toEqual([]);
  });

  test("does not share Parallel search unless the profile was live validated", async () => {
    const config = { ...loadConfig(), parallelSearchMcpUrl: "https://search.private.example/mcp" };
    const settings: RuntimeSettings = {
      searchProviderProfiles: {
        parallel: {
          url: "https://search.private.example/mcp",
          mode: "anonymous",
          validation: validationNotRequired(),
        },
      },
    };

    const catalog = await localMeshLiveCatalog({
      config,
      settings,
      sharing: { inference: true, search: true },
      secrets: new MemorySecretStore(),
    });
    expect(catalog.search).toEqual([]);
  });

  test("resolvers enforce advertised service and model allowlists", async () => {
    const config = { ...loadConfig(), aiProvider: "openai", aiApiKey: "sk-test" };
    const settings: RuntimeSettings = {
      aiProviderProfiles: {
        openai: { model: "gpt-4.1", validation: validValidation("fp") },
      },
      searchProviderProfiles: {
        parallel: { mode: "anonymous", validation: validValidation("search") },
      },
    };
    const secrets = new MemorySecretStore();
    await expect(resolveMeshInferenceService({
      config,
      settings,
      sharing: { inference: true, search: true },
      serviceId: "openai.primary",
      requestedModel: "not-advertised",
      secrets,
    })).rejects.toThrow(/model/);
    await expect(resolveMeshSearchService({
      config,
      settings,
      sharing: { inference: true, search: true },
      serviceId: "missing.search",
      secrets,
    })).rejects.toThrow(/search service/);
  });

  test("keeps the active config key ahead of an injected secret store", async () => {
    const config = { ...loadConfig(), aiProvider: "openai", aiApiKey: "config-key" };
    const secrets = new MemorySecretStore([{
      service: aithySecretService(config.botId),
      name: apiKeySecretName("openai"),
      value: "other-store-key",
    }]);
    const resolved = await resolveMeshInferenceService({
      config,
      settings: { aiProviderProfiles: { openai: { model: "gpt-4.1", validation: validValidation("fp") } } },
      sharing: { inference: true, search: false },
      serviceId: "openai.primary",
      secrets,
    });
    expect(resolved.aiApiKey).toBe("config-key");
  });

  test("reads provider and Parallel keys through scoped legacy-name fallbacks", async () => {
    const config = { ...loadConfig(), aiProvider: "anthropic", aiApiKey: undefined };
    const secrets = new MemorySecretStore([
      {
        service: aithySecretService(config.botId),
        name: "ai.openai.api-key",
        value: "legacy-openai",
      },
      {
        service: aithySecretService(config.botId),
        name: "parallel.search-api-key",
        value: "legacy-parallel",
      },
    ]);
    const settings: RuntimeSettings = {
      aiProviderProfiles: {
        openai: { model: "gpt-4.1", validation: validValidation("fp") },
      },
      searchProviderProfiles: {
        parallel: {
          url: "https://search.private.example/mcp",
          mode: "api-key",
          validation: validValidation("search"),
        },
      },
    };

    const catalog = await localMeshLiveCatalog({
      config,
      settings,
      sharing: { inference: true, search: true },
      secrets,
    });
    expect(catalog.inference.map((item) => item.id)).toEqual(["openai.primary"]);
    expect(catalog.search.map((item) => item.id)).toEqual(["parallel.search"]);
  });
});
