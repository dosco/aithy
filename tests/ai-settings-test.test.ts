import { describe, expect, test } from "bun:test";
import { assertAiSettings, assertPrimaryAiSettings } from "../app/server/ai-settings-test";
import { loadConfig } from "../src/config/env";
import {
  XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
  XAI_GROK_SUBSCRIPTION_PROVIDER,
} from "../src/agent/ai-providers";
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
    })).resolves.toBeUndefined();
  });
});
