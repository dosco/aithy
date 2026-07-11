import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AxAgentClarificationError } from "@ax-llm/ax";
import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig, type AppConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { runMessage } from "../src/agent/run-message";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("runMessage clarification notifications", () => {
  test("creates and resolves actionable clarification notifications", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const sessions = sessionsFor(root, path.join(root, "state.db"));
    const notifications: unknown[] = [];
    const resolved: unknown[] = [];
    let calls = 0;

    await runMessage(textMessage("m1", "start"), {
      config: disabledConfig(),
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      notify: (input) => notifications.push(input),
      resolveNotificationActions: (input) => resolved.push(input),
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async () => {
            calls += 1;
            if (calls === 1) throw new AxAgentClarificationError({
              question: "Which detail?",
              type: "single_choice",
              choices: ["Alpha", { label: "Beta", value: "b" }],
            });
            return { agentResponse: "answered" };
          },
        },
      }),
    });
    await runMessage(textMessage("m2", "the detail"), {
      config: disabledConfig(),
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      notify: (input) => notifications.push(input),
      resolveNotificationActions: (input) => resolved.push(input),
      agentFactory: () => ({
        llm: {},
        program: { forward: async () => ({ agentResponse: "answered" }) },
      }),
    });

    expect(notifications).toMatchObject([{
      kind: "session.clarification",
      title: "Aithy has a question",
      body: "Which detail?\n\nChoices: Alpha, Beta",
      link: "/chat/conversation",
      conversationId: "conversation",
      actionStatus: "pending",
    }]);
    expect(typeof (notifications[0] as { actionExpiresAt?: unknown }).actionExpiresAt).toBe("string");
    expect(sessions.getTranscript("conversation")[1]).toMatchObject({
      role: "assistant",
      kind: "text",
      clarification: {
        type: "single_choice",
        choices: [
          { label: "Alpha", value: "Alpha" },
          { label: "Beta", value: "b" },
        ],
      },
    });
    expect(resolved).toEqual([
      { conversationId: "conversation", kinds: ["session.clarification"] },
      { conversationId: "conversation", kinds: ["session.clarification"] },
    ]);
  });
});

function sessionsFor(root: string, dbPath: string): SessionManager {
  const sandbox = new MockSandboxProvider();
  return new SessionManager({
    sandbox,
    botId: "default",
    workspaceRoot: root,
    events: new EventBus(),
    ttlMs: 1000,
    state: new SqliteSessionStateStore(dbPath),
  });
}

function disabledConfig(): AppConfig {
  return { ...loadConfig(), sandboxProvider: "disabled" };
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
