import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig, type AppConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { runMessage } from "../src/agent/run-message";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("runMessage retrieval preload", () => {
  test("pre-recall can inject eight compact memory hits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-recall-"));
    const dbPath = path.join(root, "state.db");
    const sessions = sessionsFor(root, dbPath);
    const memory = new SqliteMemoryStore(dbPath);
    for (let index = 0; index < 10; index += 1) {
      memory.upsert({ kind: "fact", title: `Coffee ${index}`, body: `coffee planning note ${index}` });
    }
    let forwardInput: any;

    await runMessage(textMessage("m1", "coffee planning"), {
      config: disabledConfig(),
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      memory,
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            forwardInput = input;
            return { agentResponse: "done" };
          },
        },
      }),
    });

    expect(forwardInput.memoryContext.match(/^# Coffee /gm)).toHaveLength(8);
    expect(forwardInput.memoryContext).not.toContain("ID: `memory:");
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
