import { describe, expect, test } from "bun:test";
import { axGetSupportedAIModels } from "@ax-llm/ax";
import {
  AX_AI_PROVIDERS,
  CUSTOM_OPENAI_PROVIDER,
  DEFAULT_OPENAI_MODEL,
  defaultModelForProvider,
  providerDisplayName,
  isAxAiProvider,
  isCustomOpenAIProvider,
  modelsForProvider,
} from "../src/agent/ai-providers";
import { createAiService, createFastAiService } from "../src/agent/ai-service";
import { loadConfig } from "../src/config/env";

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
