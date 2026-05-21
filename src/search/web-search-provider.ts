import type { AppConfig } from "../config/env";
import { grokSubscriptionWebSearch } from "./grok-subscription-search-client";
import {
  parallelWebSearch,
  type ParallelSearchDeps,
  type ParallelSearchInput,
} from "./parallel-search-client";

export type WebSearchProviderId = "parallel" | "grok-subscription";

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
  if (config.grokSubscriptionConnected) {
    try {
      return await (deps.grokSearch ?? grokSubscriptionWebSearch)(input, config);
    } catch {
      // Auto mode treats Grok subscription search as an upgrade. Parallel stays
      // the stable fallback when sign-in is missing, expired, or not entitled.
    }
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
  if (config.grokSubscriptionConnected) {
    return { provider: "grok-subscription", mode: "grok-subscription" };
  }
  return {
    provider: "parallel",
    mode: config.parallelApiKey ? "api-key" : "anonymous",
  };
}
