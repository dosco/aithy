import { describe, expect, test } from "bun:test";
import { groupByComponent, groupByModel, usageProviderLabel } from "../app/components/usage-page-model";
import type { UsageBucketDto } from "../app/server/dto";
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

describe("usage efficiency grouping", () => {
  test("sorts models by tokens per run and groups components", () => {
    const rows: UsageBucketDto[] = [
      usageRow({ model: "big", component: "chat.actor", totalTokens: 100, calls: 2 }),
      usageRow({ model: "small", component: "chat.responder", totalTokens: 30, calls: 3, stage: "task" }),
    ];

    expect(groupByModel(rows).map((row) => [row.model, row.tokensPerCall])).toEqual([
      ["small", 10],
      ["big", 50],
    ]);
    expect(groupByComponent(rows)).toMatchObject([
      { component: "chat.actor", totalTokens: 100, tokensPerCall: 50 },
      { component: "chat.responder", stage: "task", totalTokens: 30, tokensPerCall: 10 },
    ]);
  });
});

function usageRow(patch: Partial<UsageBucketDto>): UsageBucketDto {
  return {
    bucket: "2026-05-25",
    provider: "openai",
    model: "gpt-test",
    purpose: "chat",
    component: "chat",
    stage: null,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    calls: 1,
    ...patch,
  };
}
