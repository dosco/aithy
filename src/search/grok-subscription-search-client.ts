import type { AppConfig } from "../config/env";
import { GROK_SUBSCRIPTION_API_BASE_URL } from "../grok-subscription/constants";
import {
  GrokSubscriptionAuthError,
  markGrokEntitlementDenied,
  resolveGrokSubscriptionCredentials,
} from "../grok-subscription/credentials";
import type { FetchLike } from "../grok-subscription/protocol";
import { XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL } from "../agent/ai-providers";
import type { WebSearchInput, WebSearchResult } from "./web-search-provider";

export async function grokSubscriptionWebSearch(
  input: WebSearchInput,
  config: Pick<AppConfig, "botId" | "stateDbPath">,
  deps: { fetchFn?: FetchLike } = {},
): Promise<WebSearchResult> {
  const credentials = await resolveGrokSubscriptionCredentials({
    botId: config.botId,
    stateDbPath: config.stateDbPath,
    fetchFn: deps.fetchFn,
  });
  const response = await (deps.fetchFn ?? fetch)(`${GROK_SUBSCRIPTION_API_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${credentials.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
      input: [
        {
          role: "user",
          content: searchPrompt(input),
        },
      ],
      tools: [{ type: "x_search" }],
    }),
  });
  const rawContent = await response.text();
  if (response.status === 403) {
    markGrokEntitlementDenied(config.stateDbPath);
    throw new GrokSubscriptionAuthError(
      "The connected Grok subscription is not authorized for xAI API access. Use the separate xAI API-key provider in Aithy, or upgrade the subscription.",
      "tier_denied",
    );
  }
  if (!response.ok) {
    throw new Error(`Grok subscription search failed with HTTP ${response.status}.`);
  }

  return {
    answer: extractResponseText(rawContent),
    provider: "grok-subscription",
    rawContent,
  };
}

function searchPrompt(input: WebSearchInput): string {
  const task = input.task.trim();
  const query = input.query.trim();
  return task ? `${task}\n\nSearch query: ${query}` : query;
}

function extractResponseText(rawContent: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(rawContent);
  } catch {
    return rawContent.trim();
  }
  const parts: string[] = [];
  collectText(payload, parts);
  return parts.join("\n\n").trim() || rawContent.trim();
}

function collectText(value: unknown, parts: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, parts);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.type === "output_text" || record.type === "text")
    && typeof record.text === "string"
  ) {
    parts.push(record.text);
  }
  const outputText = record.output_text;
  if (typeof outputText === "string") parts.push(outputText);
  if (Array.isArray(record.output)) collectText(record.output, parts);
  if (Array.isArray(record.content)) collectText(record.content, parts);
}
