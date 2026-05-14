import type { ChannelMessage } from "../channel/types";
import type { AppConfig } from "../config/env";
import type { ParallelSearchResult } from "../search/parallel-search-client";
import { parallelWebSearch } from "../search/parallel-search-client";
import { argsPreview } from "../security/capability-broker";
import type { BotMessage, AssistantToolCallMessage } from "../session/types";
import type { ToolContext } from "./tool-context";

const SEARCH_CONTEXT_CHARS = 8_000;
const SEARCH_RESULT_CHARS = 6_000;
const SEARCH_DIRECTIVE_RE = /\b(search|look\s+it\s+up|look\s+that\s+up|google\s+it|web\s+search)\b/i;
const CURRENT_LOOKUP_RE =
  /\b(today|yesterday|tonight|latest|current|recent|now|score|final score|result|who won|news|weather|price|stock)\b/i;

export interface SearchPrefetchAttempt {
  query: string;
  task: string;
  ok: boolean;
  result?: ParallelSearchResult;
  error?: string;
}

export interface SearchPrefetchOutput {
  context: string;
  fallbackAnswer?: string;
  attempts: SearchPrefetchAttempt[];
}

export type SearchPrefetcher = typeof prefetchSearchForMessage;

export async function prefetchSearchForMessage(input: {
  message: ChannelMessage;
  config: AppConfig;
  toolContext: ToolContext;
  onToolCall?: (message: AssistantToolCallMessage) => void;
  search?: typeof parallelWebSearch;
}): Promise<SearchPrefetchOutput | undefined> {
  const query = queryForMessage(input.message, input.toolContext.session.messages);
  if (!query) return undefined;

  const task = `Answer the user's latest request using current web search results: ${input.message.text}`;
  const toolArgs = { query, task };
  const toolMessage: AssistantToolCallMessage = {
    role: "assistant",
    kind: "tool_call",
    toolName: "web.search",
    toolArgs,
    createdAt: new Date().toISOString(),
  };

  const attempts: SearchPrefetchAttempt[] = [];
  try {
    input.toolContext.capabilities?.require({
      conversationId: input.toolContext.session.conversationId,
      capability: "web.search",
      toolName: "web.search",
      argsPreview: argsPreview(toolArgs),
    });
    input.toolContext.events.emit({
      type: "agent.turn",
      conversationId: input.toolContext.session.conversationId,
      summary: `Searching the web for ${query}`,
    });
    const result = await (input.search ?? parallelWebSearch)(toolArgs, {
      url: input.config.parallelSearchMcpUrl,
      apiKey: input.config.parallelApiKey,
    });
    attempts.push({ query, task, ok: true, result });
    toolMessage.toolResult = {
      ok: true,
      value: {
        answer: preview(result.answer, 2_000),
        provider: result.provider,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attempts.push({ query, task, ok: false, error: message });
    toolMessage.toolResult = { ok: false, value: { message } };
  }

  input.onToolCall?.(toolMessage);
  return {
    attempts,
    context: formatSearchContext(attempts),
    fallbackAnswer: fallbackAnswerFor(attempts),
  };
}

export function queryForMessage(
  message: ChannelMessage,
  history: readonly BotMessage[] = [],
): string | undefined {
  const current = message.text.trim();
  const isDirective = SEARCH_DIRECTIVE_RE.test(current);
  const isCurrentLookup = CURRENT_LOOKUP_RE.test(current);
  if (!isDirective && !isCurrentLookup) return undefined;

  const historyParts = recentUserContext(history, message);
  const directiveTopic = isDirective ? stripSearchDirective(current) : current;
  const parts = isDirective
    ? [...historyParts, ...(directiveTopic ? [directiveTopic] : [])]
    : isShortRelativeAnswer(current)
      ? [...historyParts, current]
      : [current];
  const query = normalizeQuery(parts.join(" "));
  return query || undefined;
}

function recentUserContext(
  history: readonly BotMessage[],
  current: ChannelMessage,
): string[] {
  const parts: string[] = [];
  for (let i = history.length - 1; i >= 0 && parts.length < 3; i -= 1) {
    const message = history[i];
    if (message.role !== "user") continue;
    if (isCurrentUserMessage(message, current)) continue;
    const text = message.content.trim();
    if (!text || SEARCH_DIRECTIVE_RE.test(text)) continue;
    parts.unshift(text);
    if (CURRENT_LOOKUP_RE.test(text) && !isShortRelativeAnswer(text)) break;
  }
  return parts;
}

function normalizeQuery(value: string): string {
  return value
    .replace(/\bwhat['’]?s\s+was\b/gi, "what was")
    .replace(/\bthe one yesterday\b/gi, "yesterday")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSearchDirective(value: string): string {
  return value
    .replace(/\b(search\s+it\s+up|look\s+it\s+up|look\s+that\s+up|google\s+it|web\s+search)\b/gi, "")
    .replace(/\bsearch\b/gi, "")
    .trim();
}

function isShortRelativeAnswer(value: string): boolean {
  const text = value.trim().toLowerCase();
  return /^(the\s+one\s+)?(today|yesterday|tonight|last night|latest|recent|current)\b/.test(text)
    || text.split(/\s+/).length <= 4 && /\b(one|that|it)\b/.test(text);
}

function isCurrentUserMessage(message: BotMessage, current: ChannelMessage): boolean {
  return message.role === "user"
    && message.content === current.text
    && message.createdAt === current.createdAt.toISOString();
}

function formatSearchContext(attempts: SearchPrefetchAttempt[]): string {
  const blocks = attempts.map((attempt, index) => {
    const header = `Web search ${index + 1}: ${attempt.query}`;
    if (!attempt.ok) return `${header}\nStatus: failed\nError: ${attempt.error ?? "unknown error"}`;
    const answer = preview(attempt.result?.answer ?? "", SEARCH_RESULT_CHARS);
    return `${header}\nStatus: ok\nProvider: ${attempt.result?.provider ?? "unknown"}\nResult:\n${answer}`;
  });
  const context = `Automatically fetched web search context for the latest user request:\n\n${blocks.join("\n\n")}`;
  return preview(context, SEARCH_CONTEXT_CHARS);
}

function fallbackAnswerFor(attempts: SearchPrefetchAttempt[]): string | undefined {
  const answers = attempts
    .filter((attempt) => attempt.ok && attempt.result?.answer.trim())
    .map((attempt) => attempt.result!.answer.trim());
  if (answers.length === 0) return undefined;
  return preview(answers.join("\n\n"), SEARCH_RESULT_CHARS);
}

function preview(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)} [truncated]`;
}
