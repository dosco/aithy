import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import type { AppConfig } from "../src/config/env";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { SkillPromoteQueue } from "../src/skills/promote-queue";
import { SqliteSkillPromotionStore, type SkillDraft } from "../src/skills/promote-store";
import { SqliteSkillsStore } from "../src/skills/skills-store";

const queues: SkillPromoteQueue[] = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) {
    try {
      await queue.close();
    } catch {
      // ignore
    }
  }
  try {
    shutdownManager();
  } catch {
    // ignore
  }
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-promote-queue-"));
  const stateDbPath = path.join(dir, "state.db");
  const state = new SqliteSessionStateStore(stateDbPath);
  const now = Date.now();
  state.ensureSession({
    conversationId: "parent",
    name: "Parent",
    nameSource: "generated",
    source: "test",
    now: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000),
  });
  for (let i = 0; i < 3; i += 1) {
    state.appendMessages("parent", [
      {
        role: "assistant",
        kind: "tool_call",
        toolName: "sandbox.bash",
        toolArgs: { command: "bun test", cwd: "/workspace" },
        toolResult: { exitCode: 0 },
        createdAt: new Date(now + i * 1000).toISOString(),
      },
    ]);
  }
  state.close();

  const skills = new SqliteSkillsStore(stateDbPath);
  const promotions = new SqliteSkillPromotionStore(stateDbPath);
  const posts: Array<{ parentSessionId: string; text: string; name?: string }> = [];
  const notifications: Array<{ title: string; link?: string | null }> = [];
  const draft: SkillDraft = {
    id: "bun-test-helper",
    name: "Bun Test Helper",
    description: "Run project tests consistently.",
    body: "Use `bun test` from the workspace.",
    allowedTools: "sandbox.bash",
    tags: "testing",
  };
  const queue = new SkillPromoteQueue({
    config: { stateDbPath } as AppConfig,
    skills,
    promotions,
    drafter: {
      program: {},
      forward: async () => draft,
    },
    postToSubSession: (input) => {
      posts.push(input);
      return { sessionId: `sub-${posts.length}`, messageId: posts.length };
    },
    notify: (input) => {
      notifications.push({ title: input.title, link: input.link });
    },
  });
  queues.push(queue);
  return { queue, promotions, posts, notifications };
}

describe("SkillPromoteQueue", () => {
  test("drafts one pending suggestion and links notification to the sub-session", async () => {
    const { queue, promotions, posts, notifications } = await setup();
    const result = await (queue as unknown as {
      process(data: { triggeredAt: string }): Promise<{ suggested: number }>;
    }).process({ triggeredAt: new Date().toISOString() });

    expect(result.suggested).toBe(1);
    expect(posts).toHaveLength(1);
    expect(posts[0].parentSessionId).toBe("parent");
    expect(posts[0].text).toContain("Proposed skill: Bun Test Helper");
    expect(notifications).toEqual([
      { title: "Save \"Bun Test Helper\" as a skill?", link: "/chat/sub-1" },
    ]);
    expect(promotions.pendingBySubSession("sub-1")?.draft.id).toBe("bun-test-helper");
  });

  test("skips signatures already seen by the promotion store", async () => {
    const { queue, posts, notifications } = await setup();
    const internals = queue as unknown as {
      process(data: { triggeredAt: string }): Promise<{ suggested: number }>;
    };
    expect((await internals.process({ triggeredAt: "now" })).suggested).toBe(1);
    expect((await internals.process({ triggeredAt: "later" })).suggested).toBe(0);
    expect(posts).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });
});
