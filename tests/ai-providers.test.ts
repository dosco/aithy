import { describe, expect, test } from "bun:test";
import { axGetSupportedAIModels } from "@ax-llm/ax";
import {
  AX_AI_PROVIDERS,
  AX_AI_SELECTABLE_PROVIDERS,
  CUSTOM_OPENAI_PROVIDER,
  DEFAULT_OPENAI_MODEL,
  LOCAL_AI_PROVIDER,
  XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
  XAI_GROK_SUBSCRIPTION_PROVIDER,
  defaultModelForProvider,
  capabilitiesForProviderModel,
  endpointFieldsForProvider,
  normalizeServiceTierForSelection,
  normalizeThinkingLevelForSelection,
  providerAuthentication,
  providerUsesApiUrl,
  providerDisplayName,
  isAxAiProvider,
  isCustomOpenAIProvider,
  isLocalAiProvider,
  isXaiGrokSubscriptionProvider,
  modelsForProvider,
} from "../src/agent/ai-providers";
import {
  DEFAULT_LOCAL_AGENT_MODEL_ID,
  LOCAL_CHAT_MODEL_ALIAS,
  MANAGED_LOCAL_CHAT_MODELS,
} from "../src/local-inference/manifest";
import { meshInferenceProviderId, MESH_PROXY_AUTH_TOKEN } from "../src/mesh/types";
import { createAiService, createFastAiService, resolveAiServiceConfig } from "../src/agent/ai-service";
import { loadConfig } from "../src/config/env";
import type { RuntimeStore } from "../src/runtime/runtime-store";

describe("AI provider metadata", () => {
  test("includes OpenAI from the Ax text model catalog", () => {
    expect(AX_AI_PROVIDERS).toContain("openai");
    expect(isAxAiProvider("openai")).toBe(true);
  });

  test("exposes OpenAI text models from the Ax catalog", () => {
    expect(modelsForProvider("openai").length).toBeGreaterThan(0);
  });

  test("uses the Ax catalog default model when present", () => {
    const openai = axGetSupportedAIModels({ type: "text" }).find(
      (provider) => provider.name === "openai",
    );

    expect(defaultModelForProvider("openai")).toBe(openai?.defaultModel ?? "");
    expect(DEFAULT_OPENAI_MODEL).toBe(openai?.defaultModel ?? "");
  });

  test("keeps unknown providers open for custom model entry", () => {
    expect(modelsForProvider("custom-provider")).toEqual([]);
    expect(defaultModelForProvider("custom-provider")).toBe("");
  });

  test("adds a custom OpenAI-compatible provider option", () => {
    expect(AX_AI_PROVIDERS).toContain(CUSTOM_OPENAI_PROVIDER);
    expect(isAxAiProvider(CUSTOM_OPENAI_PROVIDER)).toBe(true);
    expect(isCustomOpenAIProvider(CUSTOM_OPENAI_PROVIDER)).toBe(true);
    expect(providerDisplayName(CUSTOM_OPENAI_PROVIDER)).toBe("Custom OpenAI");
    expect(modelsForProvider(CUSTOM_OPENAI_PROVIDER)).toEqual([]);
    expect(defaultModelForProvider(CUSTOM_OPENAI_PROVIDER)).toBe("");
  });

  test("offers Ax named profiles while keeping the legacy custom id current-only", () => {
    expect(AX_AI_SELECTABLE_PROVIDERS).toContain("openai-compatible");
    expect(AX_AI_SELECTABLE_PROVIDERS).toContain("openai-responses");
    expect(AX_AI_SELECTABLE_PROVIDERS).toContain("openrouter");
    expect(AX_AI_SELECTABLE_PROVIDERS).not.toContain(CUSTOM_OPENAI_PROVIDER);
    expect(AX_AI_PROVIDERS).not.toContain("webllm");
  });

  test("uses named-profile authentication and endpoint metadata", () => {
    expect(providerAuthentication("openai")).toBe("required");
    expect(providerAuthentication("openai-compatible")).toBe("optional");
    expect(providerAuthentication("ollama")).toBe("optional");
    expect(providerUsesApiUrl("openai-compatible")).toBe(true);
    expect(endpointFieldsForProvider("azure-openai")).toEqual([
      { name: "resourceName", label: "Resource Name", required: true },
      { name: "deploymentName", label: "Deployment Name", required: true },
      { name: "version", label: "Version", required: false, defaultValue: "2024-02-15-preview" },
    ]);
  });

  test("resolves model capabilities before provider fallbacks", () => {
    expect(capabilitiesForProviderModel("openai", "gpt-5-mini").thinkingLevels).toEqual([]);
    expect(capabilitiesForProviderModel("openai", "gpt-realtime-2").serviceTiers).toEqual([]);
    expect(capabilitiesForProviderModel("google-gemini", "gemini-embedding-2")).toEqual({
      thinkingLevels: [],
      serviceTiers: [],
    });
    expect(capabilitiesForProviderModel("grok", "grok-4.6").thinkingLevels).not.toContain("none");
  });

  test("uses provider capabilities for dynamic named profiles", () => {
    expect(capabilitiesForProviderModel("azure-openai", "deployment-model").thinkingLevels).toContain("high");
    expect(capabilitiesForProviderModel("openrouter", "vendor/model").serviceTiers).toEqual([
      "standard",
      "flex",
      "priority",
    ]);
    expect(normalizeThinkingLevelForSelection("openai", "gpt-5-mini", "high")).toBeUndefined();
    expect(normalizeServiceTierForSelection("openrouter", "vendor/model", "flex")).toBe("flex");
  });

  test("adds a local provider with a managed default model", () => {
    expect(AX_AI_PROVIDERS).toContain(LOCAL_AI_PROVIDER);
    expect(isAxAiProvider(LOCAL_AI_PROVIDER)).toBe(true);
    expect(isLocalAiProvider(LOCAL_AI_PROVIDER)).toBe(true);
    expect(providerDisplayName(LOCAL_AI_PROVIDER)).toBe("Local");
    expect(modelsForProvider(LOCAL_AI_PROVIDER)).toEqual(MANAGED_LOCAL_CHAT_MODELS.map((model) => model.id));
    expect(defaultModelForProvider(LOCAL_AI_PROVIDER)).toBe(DEFAULT_LOCAL_AGENT_MODEL_ID);
  });

  test("maps family Aithy inference providers to OpenAI-compatible service settings", () => {
    const provider = meshInferenceProviderId("gpu-1");
    expect(providerDisplayName(provider)).toBe("Family Aithy");
    expect(modelsForProvider(provider)).toEqual([]);

    const service = createAiService({
      ...loadConfig({}),
      aiProvider: provider,
      aiApiUrl: "http://192.168.1.20:49321/v1",
      aiApiKey: "sk-should-not-cross-mesh",
      aiModel: "aithy-local-chat",
    });

    expect(service.getName()).toBe("OpenAI");
    expect((service as unknown as { ai: { aiImpl: { apiKey: string } } }).ai.aiImpl.apiKey).toBe(MESH_PROXY_AUTH_TOKEN);
  });

  test("adds xAI Grok Subscription as a no-key public provider", () => {
    expect(AX_AI_PROVIDERS).toContain(XAI_GROK_SUBSCRIPTION_PROVIDER);
    expect(isAxAiProvider(XAI_GROK_SUBSCRIPTION_PROVIDER)).toBe(true);
    expect(isXaiGrokSubscriptionProvider(XAI_GROK_SUBSCRIPTION_PROVIDER)).toBe(true);
    expect(providerDisplayName(XAI_GROK_SUBSCRIPTION_PROVIDER)).toBe("xAI Grok Subscription");
    expect(providerDisplayName(XAI_GROK_SUBSCRIPTION_PROVIDER)).not.toMatch(/oauth/i);
    expect(defaultModelForProvider(XAI_GROK_SUBSCRIPTION_PROVIDER)).toBe(XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL);
    expect(modelsForProvider(XAI_GROK_SUBSCRIPTION_PROVIDER)[0]).toBe(XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL);
  });

  test("maps local provider settings to Ax OpenAI service", () => {
    const service = createAiService({
      ...loadConfig({}),
      aiProvider: LOCAL_AI_PROVIDER,
      aiApiUrl: "http://127.0.0.1:1234/v1",
      aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
    });

    expect(service.getName()).toBe("OpenAI");
  });

  test("resolves local provider settings from the runtime service store", () => {
    const config = resolveAiServiceConfig({
      config: {
        ...loadConfig({}),
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
      runtimeStore: fakeRuntimeStore(),
    });

    expect(config).toMatchObject({
      aiApiUrl: "http://127.0.0.1:4321/v1",
      aiApiKey: "local",
      aiModel: LOCAL_CHAT_MODEL_ALIAS,
    });
  });

  test("throws before raw local settings can fall through to hosted OpenAI", () => {
    expect(() => createAiService({
      ...loadConfig({}),
      aiProvider: LOCAL_AI_PROVIDER,
      aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
    })).toThrow("Local inference is not ready yet");
  });

  test("maps custom OpenAI provider settings to Ax OpenAI service", () => {
    const service = createAiService({
      ...loadConfig({}),
      aiProvider: CUSTOM_OPENAI_PROVIDER,
      aiApiUrl: "https://api.example.test/v1",
      aiApiKey: "sk-test",
      aiModel: "gpt-test",
    });

    expect(service.getName()).toBe("OpenAI");
  });

  test("constructs named profiles with endpoint arguments and request defaults", () => {
    const service = createAiService({
      ...loadConfig({}),
      aiProvider: "azure-openai",
      aiApiKey: "azure-key",
      aiModel: "gpt-deployment",
      aiProfileArgs: { resourceName: "aithy-test", deploymentName: "chat" },
      aiThinkingLevel: "high",
      aiServiceTier: "priority",
    });

    expect(service.getName()).toBe("Azure OpenAI");
    expect(service.getOptions()).toMatchObject({ serviceTier: "priority" });
    expect((service as unknown as {
      ai: { aiImpl: { options: { thinkingTokenBudget?: string } } };
    }).ai.aiImpl.options.thinkingTokenBudget).toBe("high");
  });

  test("constructs the optional-key OpenAI-compatible named profile", () => {
    const service = createAiService({
      ...loadConfig({}),
      aiProvider: "openai-compatible",
      aiApiUrl: "http://127.0.0.1:8080/v1",
      aiModel: "local-model",
    });

    expect(service.getName()).toBe("OpenAI Compatible");
  });

  test("ignores incomplete fast provider settings", () => {
    expect(createFastAiService({
      ...loadConfig({}),
      fastAiProvider: "openai",
      fastAiModel: "gpt-fast",
    })).toBeUndefined();
  });

  test("fast provider can reuse the primary provider key", () => {
    expect(createFastAiService({
      ...loadConfig({}),
      aiProvider: "openai",
      aiApiKey: "sk-test",
      fastAiProvider: "openai",
      fastAiModel: "gpt-fast",
    })).toBeDefined();
  });
});

function fakeRuntimeStore(): RuntimeStore {
  return {
    service: () => ({
      role: "local-inference-worker",
      state: "ready",
      pid: 123,
      lastSeenAt: new Date().toISOString(),
      detail: {
        required: true,
        ready: true,
        chatReady: true,
        modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
        baseUrl: "http://127.0.0.1:4321",
        chatAlias: LOCAL_CHAT_MODEL_ALIAS,
      },
    }),
  } as unknown as RuntimeStore;
}
