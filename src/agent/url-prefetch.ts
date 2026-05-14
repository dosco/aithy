import type { ChannelMessage } from "../channel/types";
import type { AppConfig } from "../config/env";
import { smartScrape } from "../scraper/smart-spider";
import type { SmartScrapeResult } from "../scraper/types";
import { normalizeHttpUrl } from "../scraper/url";
import { argsPreview } from "../security/capability-broker";
import type { AssistantToolCallMessage } from "../session/types";
import type { ToolContext } from "./tool-context";

const MAX_PREFETCH_URLS = 2;
const MAX_CONTEXT_CHARS = 8_000;
const URL_UNDERSTANDING_RE =
  /\b(what|mean|means|explain|summari[sz]e|read|fetch|scrape|open|inspect|interpret|verify|check|quote|cite|analy[sz]e|look\s+(?:at|up)|tell me about)\b/i;

export interface UrlPrefetchAttempt {
  url: string;
  task: string;
  ok: boolean;
  result?: SmartScrapeResult;
  error?: string;
}

export interface UrlPrefetchOutput {
  context: string;
  fallbackAnswer?: string;
  attempts: UrlPrefetchAttempt[];
}

export type UrlPrefetcher = typeof prefetchUrlsForMessage;

export async function prefetchUrlsForMessage(input: {
  message: ChannelMessage;
  config: AppConfig;
  toolContext: ToolContext;
  onToolCall?: (message: AssistantToolCallMessage) => void;
  scrape?: typeof smartScrape;
}): Promise<UrlPrefetchOutput | undefined> {
  const urls = urlsToPrefetch(input.message.text);
  if (urls.length === 0) return undefined;

  const scrape = input.scrape ?? smartScrape;
  const attempts: UrlPrefetchAttempt[] = [];
  for (const url of urls) {
    const task = taskForUrl(input.message.text);
    const toolArgs = { url, task };
    const toolMessage: AssistantToolCallMessage = {
      role: "assistant",
      kind: "tool_call",
      toolName: "web.fetch",
      toolArgs,
      createdAt: new Date().toISOString(),
    };

    try {
      input.toolContext.capabilities?.require({
        conversationId: input.toolContext.session.conversationId,
        capability: "web.scrape",
        toolName: "web.fetch",
        argsPreview: argsPreview(toolArgs),
      });
      input.toolContext.events.emit({
        type: "agent.turn",
        conversationId: input.toolContext.session.conversationId,
        summary: `Fetching ${url}`,
      });
      const result = await scrape({ url, task }, { config: input.config });
      attempts.push({ url, task, ok: true, result });
      toolMessage.toolResult = { ok: true, value: compactScrapeResult(result) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ url, task, ok: false, error: message });
      toolMessage.toolResult = { ok: false, value: { message } };
    }

    input.onToolCall?.(toolMessage);
  }

  return {
    attempts,
    context: trimContext(formatUrlContext(attempts)),
    fallbackAnswer: fallbackAnswerFor(attempts),
  };
}

export function urlsToPrefetch(text: string): string[] {
  if (!URL_UNDERSTANDING_RE.test(text)) return [];
  return extractHttpUrls(text).slice(0, MAX_PREFETCH_URLS);
}

export function extractHttpUrls(text: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    const normalized = normalizeHttpUrl(stripTrailingUrlPunctuation(match[0]));
    if (normalized && !urls.includes(normalized)) urls.push(normalized);
  }
  return urls;
}

function taskForUrl(userText: string): string {
  return `Answer the user's request using the page content: ${userText}`;
}

function fallbackAnswerFor(attempts: UrlPrefetchAttempt[]): string | undefined {
  const answers = attempts
    .filter((attempt) => attempt.ok && attempt.result?.answer.trim())
    .map((attempt) => attempt.result!.answer.trim());
  if (answers.length === 0) return undefined;
  if (answers.length === 1) return answers[0];
  return answers.map((answer, index) => `URL ${index + 1}:\n${answer}`).join("\n\n");
}

function formatUrlContext(attempts: UrlPrefetchAttempt[]): string {
  const blocks = attempts.map((attempt, index) => {
    const header = `URL fetch ${index + 1}: ${attempt.url}`;
    if (!attempt.ok) return `${header}\nStatus: failed\nError: ${attempt.error ?? "unknown error"}`;
    const result = attempt.result!;
    const pages = result.pagesVisited.map((page) =>
      `- ${page.title || "(untitled)"}\n  URL: ${page.url}\n  Content: ${preview(page.content, 700)}`,
    );
    const errors = result.errors.length ? `\nFetch errors:\n${result.errors.map((e) => `- ${e}`).join("\n")}` : "";
    return `${header}\nStatus: ok\nSynthesized answer:\n${preview(result.answer, 2_000)}\nPages visited:\n${pages.join("\n") || "- none"}${errors}`;
  });
  return `Automatically fetched URL context for the latest user request:\n\n${blocks.join("\n\n")}`;
}

function compactScrapeResult(result: SmartScrapeResult) {
  return {
    answer: preview(result.answer, 2_000),
    pagesVisited: result.pagesVisited.map((page) => ({
      url: page.url,
      title: page.title,
      contentPreview: preview(page.content, 500),
    })),
    sources: result.sources,
    linksConsidered: result.linksConsidered.slice(0, 20),
    errors: result.errors,
  };
}

function stripTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, "");
}

function trimContext(value: string): string {
  return value.length <= MAX_CONTEXT_CHARS ? value : `${value.slice(0, MAX_CONTEXT_CHARS)}\n[truncated]`;
}

function preview(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)} [truncated]`;
}
