import { describe, expect, test } from "bun:test";
import { usageProviderLabel } from "../app/components/usage-page-model";
import { LOCAL_CHAT_MODEL_ALIAS } from "../src/local-inference/manifest";

describe("usageProviderLabel", () => {
  test("labels legacy local GGUF usage as Local", () => {
    expect(usageProviderLabel("OpenAI", "Qwen3.5-4B")).toBe("Local");
    expect(usageProviderLabel("OpenAI", LOCAL_CHAT_MODEL_ALIAS)).toBe("Local");
    expect(usageProviderLabel("OpenAI", "Qwen3.6-40B-example.gguf")).toBe("Local");
  });

  test("keeps real OpenAI model usage labeled as OpenAI", () => {
    expect(usageProviderLabel("OpenAI", "gpt-5.4-mini")).toBe("OpenAI");
  });
});
