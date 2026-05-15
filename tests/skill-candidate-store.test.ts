import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteSkillCandidateStore } from "../src/skills/candidate-store";
import { SqliteSkillPromotionStore } from "../src/skills/promote-store";

describe("SqliteSkillCandidateStore", () => {
  test("tracks cursor and candidate status transitions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-candidate-store-"));
    const store = new SqliteSkillCandidateStore(path.join(dir, "state.db"));

    expect(store.cursor()).toBe(0);
    store.setCursor(12);
    store.setCursor(10);
    expect(store.cursor()).toBe(12);

    const entry = store.upsertCandidate({
      title: "Bun Test Workflow",
      description: "Run the project test workflow.",
      canonicalText: "run bun tests for this repo",
      rationale: "The transcript repeats a test workflow.",
      confidence: 0.9,
      tags: "testing",
      sourceSessionId: "parent",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 3,
    });
    expect(entry.status).toBe("developing");
    expect(entry.seenCount).toBe(1);

    expect(store.markSuggested(entry.id, "sub-1")?.status).toBe("suggested");
    expect(store.pendingBySubSession("sub-1")?.id).toBe(entry.id);
    expect(store.markAccepted(entry.id, "bun-test-workflow")?.savedSkillId).toBe("bun-test-workflow");
    store.close();
  });

  test("dedupes candidates by canonical text and increments seen count", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-candidate-dedupe-"));
    const store = new SqliteSkillCandidateStore(path.join(dir, "state.db"));

    const first = store.upsertCandidate({
      title: "Bun Test Workflow",
      description: "Run tests.",
      canonicalText: "Run Bun tests for this repo.",
      rationale: "First pass.",
      confidence: 0.4,
      tags: null,
      sourceSessionId: "parent",
      evidenceStartMessageId: 10,
      evidenceEndMessageId: 12,
    });
    const second = store.upsertCandidate({
      title: "Bun Testing",
      description: "Run tests again.",
      canonicalText: "run bun tests for this repo",
      rationale: "Second pass.",
      confidence: 0.8,
      tags: "testing",
      sourceSessionId: "parent",
      evidenceStartMessageId: 14,
      evidenceEndMessageId: 16,
    });

    expect(second.id).toBe(first.id);
    expect(second.seenCount).toBe(2);
    expect(second.evidenceStartMessageId).toBe(10);
    expect(second.evidenceEndMessageId).toBe(16);
    store.close();
  });

  test("migrates legacy skill promotions into candidates", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-candidate-legacy-"));
    const dbPath = path.join(dir, "state.db");
    const promotions = new SqliteSkillPromotionStore(dbPath);
    promotions.createPending({
      signature: "sandbox.bash|command|bun|",
      subSessionId: "sub-legacy",
      sourceSessionId: "parent",
      sourceMessageId: 4,
      toolName: "sandbox.bash",
      argsPreview: "sandbox.bash: bun ...",
      count: 3,
      firstSeenAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: "2026-05-02T00:00:00.000Z",
      draft: {
        id: "bun-test-helper",
        name: "Bun Test Helper",
        description: "Run Bun tests.",
        body: "Use bun test.",
        allowedTools: "sandbox.bash",
        tags: "testing",
      },
    });
    promotions.close();

    const candidates = new SqliteSkillCandidateStore(dbPath);
    const migrated = candidates.pendingBySubSession("sub-legacy");
    expect(migrated).toMatchObject({
      status: "suggested",
      title: "Bun Test Helper",
      savedSkillId: null,
    });
    candidates.close();
  });
});
