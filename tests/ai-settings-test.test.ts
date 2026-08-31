import { describe, expect, test } from "bun:test";
import { assertAiSettings, assertPrimaryAiSettings } from "../app/server/ai-settings-test";
import type { AppConfig } from "../src/config/env";
import { loadConfig } from "../src/config/env";
import {
  XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
  XAI_GROK_SUBSCRIPTION_PROVIDER,
} from "../src/agent/ai-providers";
import { meshInferenceProviderId } from "../src/mesh/types";
import { DEFAULT_LOCAL_AGENT_MODEL_ID, LOCAL_AI_PROVIDER } from "../src/local-inference/manifest";

describe("AI settings validation", () => {
  test("rejects provider-backed model settings without an API key", async () => {
    await expect(assertPrimaryAiSettings({
      ...loadConfig({}),
      aiModel: "gpt-test",
    }, {
      runtime: {
        aiProvider: "openai",
        aiModel: "gpt-test",
      },
    })).rejects.toThrow(/provider API key/);
  });

  test("allows unchanged configured settings without re-testing the provider", async () => {
    await expect(assertPrimaryAiSettings({
      ...loadConfig({}),
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    }, {
      runtime: {
        aiProvider: "openai",
        aiModel: "gpt-test",
      },
    })).resolves.toBeUndefined();
  });

  test("does not smoke-test Local before the local worker is ready", async () => {
    await expect(assertPrimaryAiSettings({
      ...loadConfig({}),
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    }, {
      runtime: {
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
        localAgentModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
    })).resolves.toBeUndefined();
  });

  test("accepts family Aithy inference settings without a cloud API key", async () => {
    await expect(assertPrimaryAiSettings({
      ...loadConfig({}),
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    }, {
      runtime: {
        aiProvider: meshInferenceProviderId("gpu-1"),
        aiApiUrl: "http://127.0.0.1:49321/mesh/proxy/gpu-1/inference/default/v1",
        aiModel: "aithy-local-chat",
      },
    })).resolves.toBeUndefined();
  });

  test("accepts connected Grok subscription settings without an API key", async () => {
    await expect(assertPrimaryAiSettings({
      ...loadConfig({}),
      grokSubscriptionConnected: true,
    }, {
      runtime: {
        aiProvider: XAI_GROK_SUBSCRIPTION_PROVIDER,
        aiModel: XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
      },
    })).resolves.toBeUndefined();
  });

  test("allows explicit credential clearing for reset flows", async () => {
    await expect(assertPrimaryAiSettings({
      ...loadConfig({}),
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    }, {
      clearApiKey: true,
    })).resolves.toBeUndefined();
  });

  test("rejects a separate fast provider without its own API key", async () => {
    await expect(assertAiSettings({
      ...loadConfig({}),
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    }, {
      runtime: {
        aiProvider: "openai",
        aiModel: "gpt-test",
        fastAiProvider: "anthropic",
        fastAiModel: "claude-test",
      },
    })).rejects.toThrow(/fast provider API key/);
  });

  test("allows the fast model to reuse the primary provider key", async () => {
    const testedModels: string[] = [];
    await expect(assertAiSettings({
      ...loadConfig({}),
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    }, {
      runtime: {
        aiProvider: "openai",
        aiModel: "gpt-test",
        fastAiProvider: "openai",
        fastAiModel: "gpt-fast",
      },
    }, {
      testAiChat: async (config: AppConfig) => {
        testedModels.push(config.aiModel ?? "");
      },
    })).resolves.toBeUndefined();
    expect(testedModels).toEqual(["gpt-fast"]);
  });

  test("smoke-tests changed named-profile request options", async () => {
    const tested: AppConfig[] = [];
    await assertPrimaryAiSettings({
      ...loadConfig({}),
      aiProvider: "openrouter",
      aiModel: "vendor/model",
      aiApiKey: "sk-test",
      aiServiceTier: "auto",
    }, {
      runtime: {
        aiProvider: "openrouter",
        aiModel: "vendor/model",
        aiServiceTier: "priority",
      },
    }, {
      testAiChat: async (config) => { tested.push(config); },
    });

    expect(tested).toHaveLength(1);
    expect(tested[0]?.aiServiceTier).toBe("priority");
  });

  test("allows optional-key named profiles when their URL is complete", async () => {
    const tested: AppConfig[] = [];
    await assertPrimaryAiSettings(loadConfig({}), {
      runtime: {
        aiProvider: "openai-compatible",
        aiApiUrl: "http://127.0.0.1:8080/v1",
        aiModel: "local-model",
      },
    }, {
      testAiChat: async (config) => { tested.push(config); },
    });

    expect(tested[0]).toMatchObject({
      aiProvider: "openai-compatible",
      aiApiUrl: "http://127.0.0.1:8080/v1",
      aiModel: "local-model",
    });
  });
});
