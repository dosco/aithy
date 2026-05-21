import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { webSearch } from "../src/search/web-search-provider";

describe("web search provider routing", () => {
  test("auto routes through Grok subscription search when connected", async () => {
    let parallelCalls = 0;
    const result = await webSearch(
      { query: "latest model", task: "verify" },
      { ...loadConfig(), grokSubscriptionConnected: true },
      {
        grokSearch: async () => ({
          answer: "grok answer",
          provider: "grok-subscription",
          rawContent: "raw",
        }),
        parallelSearch: async () => {
          parallelCalls += 1;
          return { answer: "parallel", provider: "parallel", rawContent: "raw" };
        },
      },
    );

    expect(result.provider).toBe("grok-subscription");
    expect(parallelCalls).toBe(0);
  });

  test("falls back to Parallel when Grok subscription is not connected", async () => {
    let grokCalls = 0;
    const result = await webSearch(
      { query: "aithy", task: "search" },
      { ...loadConfig(), grokSubscriptionConnected: false },
      {
        grokSearch: async () => {
          grokCalls += 1;
          return { answer: "grok", provider: "grok-subscription", rawContent: "raw" };
        },
        parallelSearch: async () => ({ answer: "parallel", provider: "parallel", rawContent: "raw" }),
      },
    );

    expect(result.provider).toBe("parallel");
    expect(grokCalls).toBe(0);
  });

  test("falls back to Parallel when Grok refresh or entitlement fails", async () => {
    const result = await webSearch(
      { query: "aithy", task: "search" },
      { ...loadConfig(), grokSubscriptionConnected: true },
      {
        grokSearch: async () => {
          throw new Error("Sign in with Grok again");
        },
        parallelSearch: async () => ({ answer: "parallel", provider: "parallel", rawContent: "raw" }),
      },
    );

    expect(result).toMatchObject({ provider: "parallel", answer: "parallel" });
  });
});
