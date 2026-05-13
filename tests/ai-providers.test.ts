import { describe, expect, test } from "bun:test";
import { axGetSupportedAIModels } from "@ax-llm/ax";
import {
  AX_AI_PROVIDERS,
  DEFAULT_OPENAI_MODEL,
  defaultModelForProvider,
  isAxAiProvider,
  modelsForProvider,
} from "../src/agent/ai-providers";

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
});
