import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { webSearch } from "../src/search/web-search-provider";

describe("web search provider routing", () => {
  test("routes through Grok subscription search when selected and connected", async () => {
    let parallelCalls = 0;
    const result = await webSearch(
      { query: "latest model", task: "verify" },
      { ...loadConfig(), searchProvider: "grok-subscription", grokSubscriptionConnected: true },
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

  test("surfaces Grok refresh or entitlement failures when selected", async () => {
    await expect(webSearch(
      { query: "aithy", task: "search" },
      { ...loadConfig(), searchProvider: "grok-subscription", grokSubscriptionConnected: true },
      {
        grokSearch: async () => {
          throw new Error("Sign in with Grok again");
        },
        parallelSearch: async () => ({ answer: "parallel", provider: "parallel", rawContent: "raw" }),
      },
    )).rejects.toThrow(/Sign in with Grok again/);
  });

  test("routes mesh search through the local authenticated proxy", async () => {
    const previousFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url, init) => {
        expect(String(url)).toBe("http://127.0.0.1:3999/mesh/proxy/peer/search/parallel.search");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer aithy-mesh");
        expect(JSON.parse(String(init?.body))).toEqual({ query: "aithy", task: "search" });
        return new Response(JSON.stringify({ answer: "family answer", rawContent: "family raw" }));
      }) as typeof fetch;
      const result = await webSearch(
        { query: "aithy", task: "search" },
        {
          ...loadConfig(),
          searchProvider: "mesh:peer:search:parallel.search",
          searchApiUrl: "http://127.0.0.1:3999/mesh/proxy/peer/search/parallel.search",
        },
      );
      expect(result).toEqual({
        answer: "family answer",
        provider: "mesh:peer:search:parallel.search",
        rawContent: "family raw",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
