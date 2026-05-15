import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { SqliteSkillCandidateStore } from "../src/skills/candidate-store";
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
  const candidates = new SqliteSkillCandidateStore(dbPath);
  sessions.ensureLogicalSession("parent", { name: "Parent" });
  sessions.ensureLogicalSession("sub-1", {
    name: "Skill suggestion",
    parentSessionId: "parent",
    source: "skill.candidates",
  });
  const candidate = candidates.upsertCandidate({
    title: "Bun Test Workflow",
    description: "Run tests consistently.",
    canonicalText: "run bun tests for this repo",
    rationale: "The workflow is reusable.",
    confidence: 0.9,
    tags: "testing",
    sourceSessionId: "parent",
    evidenceStartMessageId: 1,
    evidenceEndMessageId: 2,
  });
  candidates.markSuggested(candidate.id, "sub-1");
  return { dbPath, sessions, skills, promotions, candidates, candidateId: candidate.id };
}

describe("handleSkillPromotionReply", () => {
  test("accepts a candidate suggestion, drafts with the default path, and saves the skill", async () => {
    const { dbPath, sessions, skills, promotions, candidates, candidateId } = await setup();
    let draftCalls = 0;
    const result = await handleSkillPromotionReply({
      conversationId: "sub-1",
      text: "save it",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      config: { stateDbPath: dbPath } as AppConfig,
      sessions,
      candidates,
      promotions,
      skills,
      drafter: {
        program: {},
        forward: async () => {
          draftCalls += 1;
          return {
            id: "bun-test-helper",
            name: "Bun Test Helper",
            description: "Run tests consistently.",
            body: "Use `bun test`.",
            allowedTools: "sandbox.bash",
            tags: "testing",
          };
        },
      },
      loadEvidence: () => "evidence",
    });

    expect(result.handled).toBe(true);
    expect(draftCalls).toBe(1);
    expect(skills.get("bun-test-helper")?.name).toBe("Bun Test Helper");
    expect(candidates.get(candidateId)?.status).toBe("accepted");
    expect(sessions.getTranscript("sub-1").at(-1)).toMatchObject({
      role: "assistant",
      kind: "text",
      content: "Saved \"Bun Test Helper\" to Skills.",
    });
  });

  test("dismisses a candidate suggestion without drafting", async () => {
    const { dbPath, sessions, skills, promotions, candidates, candidateId } = await setup();
    let draftCalls = 0;
    const result = await handleSkillPromotionReply({
      conversationId: "sub-1",
      text: "no",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      config: { stateDbPath: dbPath } as AppConfig,
      sessions,
      candidates,
      promotions,
      skills,
      drafter: {
        program: {},
        forward: async () => {
          draftCalls += 1;
          throw new Error("should not draft");
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(draftCalls).toBe(0);
    expect(skills.get("bun-test-helper")).toBeNull();
    expect(candidates.get(candidateId)?.status).toBe("dismissed");
    expect(result.assistant?.content).toBe("Dismissed \"Bun Test Workflow\".");
  });

  test("keeps candidate suggestions pending for non-choice replies", async () => {
    const { dbPath, sessions, skills, promotions, candidates, candidateId } = await setup();
    const result = await handleSkillPromotionReply({
      conversationId: "sub-1",
      text: "what does this do?",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      config: { stateDbPath: dbPath } as AppConfig,
      sessions,
      candidates,
      promotions,
      skills,
    });

    expect(result.handled).toBe(true);
    expect(skills.get("bun-test-helper")).toBeNull();
    expect(candidates.get(candidateId)?.status).toBe("suggested");
    expect(result.assistant?.content).toContain("Reply `save`");
  });

  test("legacy pending promotion replies still save the stored draft", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-promote-legacy-"));
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
    sessions.ensureLogicalSession("legacy-sub", {
      name: "Skill suggestion",
      parentSessionId: "parent",
      source: "skill.promote",
    });
    promotions.createPending({
      signature: "sig",
      subSessionId: "legacy-sub",
      sourceSessionId: "parent",
      toolName: "sandbox.bash",
      argsPreview: "sandbox.bash: bun ...",
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

    const result = await handleSkillPromotionReply({
      conversationId: "legacy-sub",
      text: "save",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      sessions,
      promotions,
      skills,
    });

    expect(result.handled).toBe(true);
    expect(skills.get("bun-test-helper")?.name).toBe("Bun Test Helper");
    expect(promotions.get("sig")?.status).toBe("accepted");
  });

  test("migrated legacy suggestions keep using the stored draft", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-promote-migrated-"));
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
    sessions.ensureLogicalSession("legacy-sub", {
      name: "Skill suggestion",
      parentSessionId: "parent",
      source: "skill.promote",
    });
    promotions.createPending({
      signature: "sig",
      subSessionId: "legacy-sub",
      sourceSessionId: "parent",
      toolName: "sandbox.bash",
      argsPreview: "sandbox.bash: bun ...",
      count: 3,
      firstSeenAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: "2026-05-02T00:00:00.000Z",
      draft: {
        id: "stored-draft",
        name: "Stored Draft",
        description: "Use the stored legacy draft.",
        body: "Stored body.",
        allowedTools: "sandbox.bash",
        tags: "testing",
      },
    });
    const candidates = new SqliteSkillCandidateStore(dbPath);
    let draftCalls = 0;

    const result = await handleSkillPromotionReply({
      conversationId: "legacy-sub",
      text: "save",
      createdAt: new Date("2026-05-03T00:00:00.000Z"),
      config: { stateDbPath: dbPath } as AppConfig,
      sessions,
      candidates,
      promotions,
      skills,
      drafter: {
        program: {},
        forward: async () => {
          draftCalls += 1;
          throw new Error("should not redraft migrated legacy suggestions");
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(draftCalls).toBe(0);
    expect(skills.get("stored-draft")?.body).toBe("Stored body.");
    expect(promotions.get("sig")?.status).toBe("accepted");
    expect(candidates.pendingBySubSession("legacy-sub")).toBeNull();
  });
});
