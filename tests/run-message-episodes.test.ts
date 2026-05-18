import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { runMessage } from "../src/agent/run-message";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig } from "../src/config/env";

describe("runMessage episode recall", () => {
  test("memory recall includes prefixed episode strategy hints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-episodes-"));
    const events = new EventBus();
    const emitted: unknown[] = [];
    events.subscribe((event) => emitted.push(event));
    const sessions = sessionsFor(root, path.join(root, "state.db"));
    const seenMemoryExcludes: unknown[] = [];
    const seenEpisodeExcludes: unknown[] = [];

    await runMessage(textMessage("m1", "test the postgres fix"), {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events,
      sandbox: new MockSandboxProvider(),
      sessions,
      memory: {
        search: async (_queries: string[], opts: { excludeIds?: string[] }) => {
          seenMemoryExcludes.push(opts.excludeIds);
          return [{
            id: "mem-1",
            kind: "fact",
            title: "Postgres project",
            body: "The project has postgres tests.",
            labels: ["project"],
            validFrom: null,
            validUntil: null,
            durationDays: null,
            evidence: null,
            frequency: null,
            source: null,
            importance: 0.6,
            createdAt: "2026-04-30T00:00:00.000Z",
            updatedAt: "2026-04-30T00:00:00.000Z",
            lastRecalledAt: null,
            recallCount: 0,
            retrievedCount: 0,
            supersededBy: null,
          }];
        },
      } as any,
      episodes: {
        search: async (_queries: string[], opts: { excludeIds?: string[] }) => {
          seenEpisodeExcludes.push(opts.excludeIds);
          return [{
            id: "ep-1",
            dedupeKey: "k",
            task: "Debug postgres tests",
            approach: "Ran targeted postgres tests before the broad suite.",
            outcome: "success",
            notes: "Targeted database tests gave the useful signal.",
            toolNames: ["sandbox.bash"],
            sourceSessionId: "old-session",
            evidenceStartMessageId: 1,
            evidenceEndMessageId: 3,
            error: null,
            artifactIds: [],
            importance: 0.7,
            seenCount: 1,
            createdAt: "2026-04-30T00:00:00.000Z",
            updatedAt: "2026-04-30T00:00:00.000Z",
            lastRecalledAt: null,
            recallCount: 0,
            retrievedCount: 0,
          }];
        },
      } as any,
      agentFactory: (options: any) => ({
        llm: {},
        program: {
          forward: async () => {
            await options.onMemoriesSearch(["postgres tests"], [
              { id: "memory:loaded-mem", content: "" },
              { id: "episode:loaded-episode", content: "" },
            ]);
            return { agentResponse: "done" };
          },
        },
      }),
    });

    expect(seenMemoryExcludes).toEqual([["loaded-mem"]]);
    expect(seenEpisodeExcludes).toEqual([["loaded-episode"]]);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "agent.tool_call",
        message: expect.objectContaining({
          toolName: "memory.recall",
          toolResult: {
            matches: [
              expect.objectContaining({ id: "memory:mem-1" }),
              expect.objectContaining({
                id: "episode:ep-1",
                contentPreview: expect.stringContaining("Past similar task: Debug postgres tests"),
              }),
            ],
          },
        }),
      }),
    );
  });
});

function sessionsFor(root: string, dbPath: string): SessionManager {
  return new SessionManager({
    sandbox: new MockSandboxProvider(),
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
    channelId: "web",
    conversationId: "conversation",
    senderId: "user",
    text,
    createdAt: new Date(),
  };
}
