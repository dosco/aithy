import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OPENAI_MODEL,
  defaultModelForProvider,
  modelsForProvider,
} from "../src/agent/ai-providers";

describe("AI provider metadata", () => {
  test("defaults setup to GPT-5.4 mini for OpenAI", () => {
    expect(defaultModelForProvider("openai")).toBe(DEFAULT_OPENAI_MODEL);
    expect(defaultModelForProvider("anthropic")).toBe("");
  });

  test("includes the OpenAI setup default in selectable models", () => {
    expect(modelsForProvider("openai")).toContain(DEFAULT_OPENAI_MODEL);
  });
});
