import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createTrackedSkills, enqueuePostTurnBackgroundTasks } from "../src/runtime/process-user-chat-job";
import { EventBus } from "../src/events/bus";
import { SqliteSkillsStore } from "../src/skills/skills-store";

describe("processUserChatJob skill tracking", () => {
  test("tracks selected and Ax-discovered skills once per turn", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-skill-tracking-"));
    const store = new SqliteSkillsStore(path.join(dir, "state.db"));
    try {
      store.upsert({
        id: "shell-helper",
        name: "Shell Helper",
        description: "Use shell commands carefully.",
        body: "Prefer boring shell commands.",
        allowedTools: null,
        tags: "shell",
      });
      store.upsert({
        id: "coffee-finder",
        name: "Coffee Finder",
        description: "Find coffee options and cafe ideas.",
        body: "Use for coffee planning.",
        allowedTools: null,
        tags: "coffee",
      });

      const tracked = createTrackedSkills(store, ["shell-helper"]);
      expect(store.get("shell-helper")?.retrieved_count).toBe(1);

      expect((await tracked.skillsSearch(["coffee"])).map((skill) => skill.name)).toEqual(["Coffee Finder"]);
      expect(store.get("coffee-finder")?.retrieved_count).toBe(1);

      await tracked.skillsSearch(["coffee"]);
      await tracked.skillsSearch(["shell"]);
      expect(store.get("coffee-finder")?.retrieved_count).toBe(1);
      expect(store.get("shell-helper")?.retrieved_count).toBe(1);

      tracked.onUsedSkills([{ id: "coffee-finder", name: "Coffee Finder", reason: "answered cafe request", stage: "executor" }]);
      tracked.onUsedSkills([{ id: "coffee-finder", name: "Coffee Finder", reason: "duplicate", stage: "executor" }]);
      expect(store.get("coffee-finder")?.used_count).toBe(1);
      expect(store.get("coffee-finder")?.recent_usage[0].reason).toBe("answered cafe request");
    } finally {
      store.close();
    }
  });

  test("returns full search-discovered skill payloads", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-skill-cap-"));
    const store = new SqliteSkillsStore(path.join(dir, "state.db"));
    store.upsert({
      id: "long-skill",
      name: "Long Skill",
      description: "Long body.",
      body: "repeat ".repeat(800),
      allowedTools: null,
      tags: "long",
    });

    const tracked = createTrackedSkills(store, []);
    const [result] = await tracked.skillsSearch(["long"]);
    expect(result.content).toContain("repeat ".repeat(800));
    expect(result.content).not.toContain("[truncated]");
  });
});

describe("post-turn background tasks", () => {
  test("enqueues dream and skill detection for top-level sessions", async () => {
    const calls: string[] = [];
    await enqueuePostTurnBackgroundTasks({
      events: new EventBus(),
      sessions: { getSummary: () => ({ parentSessionId: null }) } as any,
      dreamQueue: { enqueueAuto: async (sessionId: string) => calls.push(`dream:${sessionId}`) } as any,
      skillCandidateQueue: { enqueueAuto: async () => calls.push("skill") } as any,
    }, "main");

    expect(calls).toEqual(["dream:main", "skill"]);
  });

  test("does not enqueue dream or skill detection for sub-sessions", async () => {
    const calls: string[] = [];
    await enqueuePostTurnBackgroundTasks({
      events: new EventBus(),
      sessions: { getSummary: () => ({ parentSessionId: "parent" }) } as any,
      dreamQueue: { enqueueAuto: async () => calls.push("dream") } as any,
      skillCandidateQueue: { enqueueAuto: async () => calls.push("skill") } as any,
    }, "child");

    expect(calls).toEqual([]);
  });
});
