import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from "../src/channel/types";
import { runMessage } from "../src/agent/run-message";
import { SqliteArtifactStore } from "../src/artifacts/artifact-store";
import { loadConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("artifact intent repair", () => {
  test("repairs file creation turns that did not publish an artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-artifact-intent-"));
    const dbPath = path.join(root, "state.db");
    const workspaceRoot = path.join(root, "workspace");
    const outboxRoot = path.join(root, "outbox");
    const artifacts = new SqliteArtifactStore(dbPath, workspaceRoot, outboxRoot);
    const sessions = sessionsFor(workspaceRoot, dbPath);
    const seenRequests: string[] = [];
    let calls = 0;

    await runMessage(textMessage("create a file called bird.txt with a haiku"), {
      config: {
        ...loadConfig(),
        sandboxProvider: "disabled",
        stateDir: root,
        stateDbPath: dbPath,
        workspaceRoot,
        outboxRoot,
      },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      artifacts,
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            seenRequests.push(input.userRequest);
            calls += 1;
            if (calls === 1) return { agentResponse: "Done, bird.txt exists." };
            await artifacts.write({
              sessionId: "conversation",
              runId: parseArtifactContext(input.artifactContext, "Current run id"),
              runOutboxPath: parseArtifactContext(input.artifactContext, "Current run outbox"),
              path: "bird.txt",
              content: "Sunlit wings rise high\nMorning sings from swaying trees\nSmall hearts fill the sky\n",
            });
            return { agentResponse: "Published bird.txt." };
          },
        },
      }),
    });

    const transcript = sessions.getTranscript("conversation");
    expect(seenRequests).toHaveLength(2);
    expect(seenRequests[1]).toContain("previous response did not publish");
    expect(transcript).toMatchObject([
      { role: "user", content: "create a file called bird.txt with a haiku" },
      { role: "assistant", kind: "artifact", filename: "bird.txt" },
      { role: "assistant", kind: "text", content: "Published bird.txt." },
    ]);
    artifacts.close();
  });
});

function parseArtifactContext(context: string, label: string): string {
  return context.match(new RegExp(`${label}: (.+)`))?.[1] ?? "";
}

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

function textMessage(text: string): ChannelMessage {
  return {
    id: "m1",
    channelId: "channel",
    conversationId: "conversation",
    senderId: "user",
    text,
    createdAt: new Date("2026-04-30T00:00:00Z"),
  };
}
