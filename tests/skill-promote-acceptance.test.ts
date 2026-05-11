import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { handleSkillPromotionReply } from "../src/skills/promote-acceptance";
import { SqliteSkillPromotionStore } from "../src/skills/promote-store";
import { SqliteSkillsStore } from "../src/skills/skills-store";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-promote-accept-"));
  const dbPath = path.join(dir, "state.db");
  const sessions = new SessionManager({
    sandbox: new MockSandboxProvider(),
    botId: "default",
    workspaceRoot: path.join(dir, "ws"),
    events: new EventBus(),
    ttlMs: 60_000,
    state: new SqliteSessionStateStore(dbPath),
  });
  const skills = new SqliteSkillsStore(dbPath);
  const promotions = new SqliteSkillPromotionStore(dbPath);
  sessions.ensureLogicalSession("parent", { name: "Parent" });
  sessions.ensureLogicalSession("sub-1", {
    name: "Skill suggestion",
    parentSessionId: "parent",
    source: "skill.promote",
  });
  promotions.createPending({
    signature: "sig",
    subSessionId: "sub-1",
    sourceSessionId: "parent",
    toolName: "sandbox.bash",
    argsPreview: "sandbox.bash: bun …",
    count: 3,
    firstSeenAt: "2026-05-01T00:00:00.000Z",
    lastSeenAt: "2026-05-02T00:00:00.000Z",
    draft: {
      id: "bun-test-helper",
      name: "Bun Test Helper",
      description: "Run tests consistently.",
      body: "Use `bun test`.",
      allowedTools: "sandbox.bash",
      tags: "testing",
    },
  });
  return { sessions, skills, promotions };
}

describe("handleSkillPromotionReply", () => {
  test("accepts a pending suggestion and saves the skill", async () => {
    const { sessions, skills, promotions } = await setup();
    const result = handleSkillPromotionReply({
      conversationId: "sub-1",
      text: "save it",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      sessions,
      skills,
      promotions,
    });

    expect(result.handled).toBe(true);
    expect(skills.get("bun-test-helper")?.name).toBe("Bun Test Helper");
    expect(promotions.get("sig")?.status).toBe("accepted");
    expect(sessions.getTranscript("sub-1").at(-1)).toMatchObject({
      role: "assistant",
      kind: "text",
      content: "Saved \"Bun Test Helper\" to Skills.",
    });
  });

  test("dismisses a pending suggestion without saving", async () => {
    const { sessions, skills, promotions } = await setup();
    const result = handleSkillPromotionReply({
      conversationId: "sub-1",
      text: "no",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      sessions,
      skills,
      promotions,
    });

    expect(result.handled).toBe(true);
    expect(skills.get("bun-test-helper")).toBeNull();
    expect(promotions.get("sig")?.status).toBe("dismissed");
    expect(sessions.getTranscript("sub-1").at(-1)).toMatchObject({
      role: "assistant",
      kind: "text",
      content: "Dismissed \"Bun Test Helper\".",
    });
  });

  test("keeps pending suggestions scoped to accept or dismiss replies", async () => {
    const { sessions, skills, promotions } = await setup();
    const result = handleSkillPromotionReply({
      conversationId: "sub-1",
      text: "what does this do?",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      sessions,
      skills,
      promotions,
    });

    expect(result.handled).toBe(true);
    expect(skills.get("bun-test-helper")).toBeNull();
    expect(promotions.get("sig")?.status).toBe("pending");
    expect(result.assistant?.content).toContain("Reply `save`");
  });
});
