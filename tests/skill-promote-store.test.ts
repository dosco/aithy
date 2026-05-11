import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteSkillPromotionStore } from "../src/skills/promote-store";

describe("SqliteSkillPromotionStore", () => {
  test("stores pending drafts and transitions status", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-promote-store-"));
    const store = new SqliteSkillPromotionStore(path.join(dir, "state.db"));

    const entry = store.createPending({
      signature: "sandbox.bash|command|bun|",
      subSessionId: "sub-1",
      sourceSessionId: "parent",
      sourceMessageId: 12,
      toolName: "sandbox.bash",
      argsPreview: "sandbox.bash: bun …",
      count: 4,
      firstSeenAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: "2026-05-02T00:00:00.000Z",
      draft: {
        id: "bun-test-helper",
        name: "Bun Test Helper",
        description: "Run the project test workflow.",
        body: "Use bun test.",
        allowedTools: "sandbox.bash",
        tags: "testing",
      },
    });

    expect(entry.status).toBe("pending");
    expect(store.hasSignature(entry.signature)).toBe(true);
    expect(store.pendingBySubSession("sub-1")?.draft.name).toBe("Bun Test Helper");

    store.markAccepted(entry.signature, "bun-test-helper");
    expect(store.pendingBySubSession("sub-1")).toBeNull();
    expect(store.get(entry.signature)?.status).toBe("accepted");
    expect(store.get(entry.signature)?.savedSkillId).toBe("bun-test-helper");
    store.close();
  });

  test("enforces one row per signature", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-promote-dupe-"));
    const store = new SqliteSkillPromotionStore(path.join(dir, "state.db"));
    const input = {
      signature: "sig",
      subSessionId: "sub-1",
      sourceSessionId: "parent",
      toolName: "tool",
      argsPreview: "tool",
      count: 3,
      firstSeenAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: "2026-05-02T00:00:00.000Z",
      draft: {
        id: "draft",
        name: "Draft",
        description: "Draft.",
        body: "Body.",
        allowedTools: null,
        tags: null,
      },
    };
    store.createPending(input);
    expect(() => store.createPending({ ...input, subSessionId: "sub-2" })).toThrow();
    store.close();
  });
});
