import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { runMessage } from "../src/agent/run-message";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("runMessage profile input", () => {
  test("passes user profile as agent input data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-profile-"));
    const seenInputs: any[] = [];

    await runMessage(textMessage("m1", "hello"), {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions: sessionsFor(root, path.join(root, "state.db")),
      profile: {
        userName: "Violet",
        userLocation: "Vancouver",
        updatedAt: "2026-05-02T12:00:00.000Z",
      },
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            seenInputs.push(input);
            return { agentResponse: "hello" };
          },
        },
      }),
    });

    expect(seenInputs[0].userProfile).toEqual({
      name: "Violet",
      location: "Vancouver",
    });
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
