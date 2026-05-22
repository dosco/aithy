import type { AppConfig } from "../config/env";
import { isMeshSearchProvider, MESH_PROXY_AUTH_TOKEN } from "../mesh/types";
import type { SearchProviderId } from "../settings/types";
import { grokSubscriptionWebSearch } from "./grok-subscription-search-client";
import {
  parallelWebSearch,
  type ParallelSearchDeps,
  type ParallelSearchInput,
} from "./parallel-search-client";

export type WebSearchProviderId = SearchProviderId;

export type WebSearchInput = ParallelSearchInput;

export interface WebSearchResult {
  answer: string;
  provider: WebSearchProviderId;
  rawContent: string;
}

export interface WebSearchDeps {
  grokSearch?: typeof grokSubscriptionWebSearch;
  parallelSearch?: typeof parallelWebSearch;
  parallelDeps?: ParallelSearchDeps;
}

export async function webSearch(
  input: WebSearchInput,
  config: AppConfig,
  deps: WebSearchDeps = {},
): Promise<WebSearchResult> {
  const provider = config.searchProvider ?? "parallel";
  if (isMeshSearchProvider(provider)) {
    return meshWebSearch(input, config);
  }
  if (provider === "grok-subscription") {
    return await (deps.grokSearch ?? grokSubscriptionWebSearch)(input, config);
  }
  return (deps.parallelSearch ?? parallelWebSearch)(
    input,
    { url: config.parallelSearchMcpUrl, apiKey: config.parallelApiKey },
    deps.parallelDeps,
  );
}

export function activeWebSearchBackend(config: AppConfig): {
  provider: WebSearchProviderId;
  mode: "grok-subscription" | "api-key" | "anonymous";
} {
  const provider = config.searchProvider ?? "parallel";
  if (isMeshSearchProvider(provider)) {
    return { provider, mode: "api-key" };
  }
  if (provider === "grok-subscription") {
    return { provider: "grok-subscription", mode: "grok-subscription" };
  }
  return {
    provider: "parallel",
    mode: config.parallelApiKey ? "api-key" : "anonymous",
  };
}

async function meshWebSearch(input: WebSearchInput, config: AppConfig): Promise<WebSearchResult> {
  if (!config.searchApiUrl) throw new Error("Family search proxy is not available.");
  const response = await fetch(config.searchApiUrl, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${MESH_PROXY_AUTH_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null) as { error?: string; answer?: string; rawContent?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `Family search failed with HTTP ${response.status}.`);
  const rawContent = body?.rawContent ?? body?.answer ?? "";
  return { answer: body?.answer ?? rawContent, provider: config.searchProvider ?? "parallel", rawContent };
}
