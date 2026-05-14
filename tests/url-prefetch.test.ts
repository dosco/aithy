import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AxAgentClarificationError } from "@ax-llm/ax";
import { describe, expect, test } from "bun:test";
import { runMessage } from "../src/agent/run-message";
import { extractHttpUrls, prefetchUrlsForMessage, urlsToPrefetch } from "../src/agent/url-prefetch";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("url prefetch", () => {
  test("extracts and gates direct URL understanding requests", () => {
    expect(extractHttpUrls("see https://example.com/post?s=20.")).toEqual([
      "https://example.com/post?s=20",
    ]);
    expect(urlsToPrefetch("what do they mean by this https://example.com/post")).toEqual([
      "https://example.com/post",
    ]);
    expect(urlsToPrefetch("save https://example.com/post for later")).toEqual([]);
  });

  test("records web.fetch and formats URL context", async () => {
    const events = new EventBus();
    const toolCalls: unknown[] = [];
    const output = await prefetchUrlsForMessage({
      message: textMessage("m1", "what does this mean https://example.com/post?s=20"),
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      toolContext: { session: { conversationId: "conversation" }, events } as any,
      onToolCall: (message) => toolCalls.push(message),
      scrape: async ({ url }) => ({
        answer: `It means the launch is live at [the post](${url}).`,
        pagesVisited: [{ url, title: "Launch", content: "The launch is live today." }],
        sources: [{ id: "S1", url, title: "Launch" }],
        linksConsidered: [],
        errors: [],
      }),
    });

    expect(output?.context).toContain("Automatically fetched URL context");
    expect(output?.context).toContain("The launch is live today.");
    expect(output?.fallbackAnswer).toContain("the launch is live");
    expect(toolCalls).toContainEqual(expect.objectContaining({
      toolName: "web.fetch",
      toolResult: expect.objectContaining({ ok: true }),
    }));
  });
});

describe("runMessage URL prefetch integration", () => {
  test("passes prefetched URL context to the agent and persists the tool call", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-url-prefetch-"));
    const sessions = sessionsFor(root);
    const seenInputs: any[] = [];

    const reply = await runMessage(textMessage("m1", "what does this mean https://example.com/post"), {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      urlPrefetcher: async ({ onToolCall }) => {
        onToolCall?.(webFetchToolCall());
        return {
          attempts: [],
          context: "Fetched URL says the launch is live.",
          fallbackAnswer: "The launch is live.",
        };
      },
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            seenInputs.push(input);
            return { agentResponse: input.urlContext.includes("launch is live") ? "It means the launch is live." : "missing" };
          },
        },
      }),
    });

    expect(reply.text).toBe("It means the launch is live.");
    expect(seenInputs[0].urlContext).toContain("launch is live");
    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "what does this mean https://example.com/post" },
      { role: "assistant", kind: "tool_call", toolName: "web.fetch" },
      { role: "assistant", kind: "text", content: "It means the launch is live." },
    ]);
  });

  test("uses the prefetched answer instead of returning a clarification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-url-prefetch-"));
    const events = new EventBus();
    const emitted: unknown[] = [];
    events.subscribe((event) => emitted.push(event));

    const reply = await runMessage(textMessage("m1", "what does this mean https://example.com/post"), {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events,
      sandbox: new MockSandboxProvider(),
      sessions: sessionsFor(root),
      urlPrefetcher: async ({ onToolCall }) => {
        onToolCall?.(webFetchToolCall());
        return {
          attempts: [],
          context: "Fetched URL says the launch is live.",
          fallbackAnswer: "The launch is live.",
        };
      },
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async () => {
            throw new AxAgentClarificationError("Please paste the text.");
          },
        },
      }),
    });

    expect(reply.text).toBe("The launch is live.");
    expect(emitted).not.toContainEqual(expect.objectContaining({ type: "agent.clarification" }));
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

function webFetchToolCall() {
  return {
    role: "assistant" as const,
    kind: "tool_call" as const,
    toolName: "web.fetch",
    toolArgs: { url: "https://example.com/post", task: "explain" },
    toolResult: { ok: true, value: { answer: "The launch is live." } },
    createdAt: new Date("2026-04-30T00:00:01Z").toISOString(),
  };
}
