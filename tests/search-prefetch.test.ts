import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AxAgentClarificationError } from "@ax-llm/ax";
import { describe, expect, test } from "bun:test";
import { runMessage } from "../src/agent/run-message";
import { prefetchSearchForMessage, queryForMessage } from "../src/agent/search-prefetch";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { BotMessage } from "../src/session/types";

describe("search prefetch", () => {
  test("searches current lookup questions directly", () => {
    expect(queryForMessage(textMessage("m1", "what's was the score in the giants vs dodgers game"))).toBe(
      "what was the score in the giants vs dodgers game",
    );
  });

  test("resolves search directives from recent user context", () => {
    const history: BotMessage[] = [
      user("what's was the score in the giants vs dodgers game"),
      assistant("Which game do you mean?"),
      user("the one yesterday"),
      assistant("I need the date."),
    ];

    expect(queryForMessage(textMessage("m2", "search it up"), history)).toBe(
      "what was the score in the giants vs dodgers game yesterday",
    );
  });

  test("records web.search and formats search context", async () => {
    const toolCalls: unknown[] = [];
    const output = await prefetchSearchForMessage({
      message: textMessage("m1", "what was the Giants Dodgers score yesterday"),
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      toolContext: { session: { conversationId: "conversation", messages: [] }, events: new EventBus() } as any,
      onToolCall: (message) => toolCalls.push(message),
      search: async ({ query }) => ({
        answer: `The Dodgers beat the Giants 5-2. Query: ${query}`,
        provider: "parallel",
        rawContent: "raw",
      }),
    });

    expect(output?.context).toContain("Automatically fetched web search context");
    expect(output?.context).toContain("Dodgers beat the Giants 5-2");
    expect(output?.fallbackAnswer).toContain("5-2");
    expect(toolCalls).toContainEqual(expect.objectContaining({
      toolName: "web.search",
      toolResult: expect.objectContaining({ ok: true }),
    }));
  });
});

describe("runMessage search prefetch integration", () => {
  test("passes search context to the agent and persists the tool call", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-search-prefetch-"));
    const sessions = sessionsFor(root);
    const seenInputs: any[] = [];

    const reply = await runMessage(textMessage("m1", "what was the Giants Dodgers score yesterday"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      searchPrefetcher: async ({ onToolCall }) => {
        onToolCall?.(webSearchToolCall());
        return {
          attempts: [],
          context: "Search result says Dodgers beat Giants 5-2.",
          fallbackAnswer: "Dodgers beat Giants 5-2.",
        };
      },
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            seenInputs.push(input);
            return { agentResponse: input.searchContext.includes("5-2") ? "Dodgers won 5-2." : "missing" };
          },
        },
      }),
    });

    expect(reply.text).toBe("Dodgers won 5-2.");
    expect(seenInputs[0].searchContext).toContain("5-2");
    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "what was the Giants Dodgers score yesterday" },
      { role: "assistant", kind: "tool_call", toolName: "web.search" },
      { role: "assistant", kind: "text", content: "Dodgers won 5-2." },
    ]);
  });

  test("uses the searched answer instead of returning a clarification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-search-prefetch-"));

    const reply = await runMessage(textMessage("m1", "what was the Giants Dodgers score yesterday"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions: sessionsFor(root),
      searchPrefetcher: async ({ onToolCall }) => {
        onToolCall?.(webSearchToolCall());
        return {
          attempts: [],
          context: "Search result says Dodgers beat Giants 5-2.",
          fallbackAnswer: "Dodgers beat Giants 5-2.",
        };
      },
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async () => {
            throw new AxAgentClarificationError("Which game?");
          },
        },
      }),
    });

    expect(reply.text).toBe("Dodgers beat Giants 5-2.");
  });
});

function sessionsFor(root: string): SessionManager {
  const sandbox = new MockSandboxProvider();
  return new SessionManager({
    sandbox,
    botId: "default",
    workspaceRoot: root,
    events: new EventBus(),
    ttlMs: 1000,
    state: new SqliteSessionStateStore(path.join(root, "state.db")),
  });
}

function textMessage(id: string, text: string): ChannelMessage {
  return {
    id,
    channelId: "channel",
    conversationId: "conversation",
    senderId: "user",
    text,
    createdAt: new Date("2026-04-30T00:00:00Z"),
  };
}

function user(content: string): BotMessage {
  return { role: "user", content, createdAt: "2026-04-30T00:00:00.000Z" };
}

function assistant(content: string): BotMessage {
  return { role: "assistant", kind: "text", content, createdAt: "2026-04-30T00:00:00.000Z" };
}

function webSearchToolCall() {
  return {
    role: "assistant" as const,
    kind: "tool_call" as const,
    toolName: "web.search",
    toolArgs: { query: "Giants Dodgers score", task: "score" },
    toolResult: { ok: true, value: { answer: "Dodgers beat Giants 5-2." } },
    createdAt: new Date("2026-04-30T00:00:01Z").toISOString(),
  };
}
