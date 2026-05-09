import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteMemoryRunsStore } from "../src/memory/memory-runs";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-memruns-"));
  return path.join(dir, "state.db");
}

describe("SqliteMemoryRunsStore", () => {
  test("records start, complete, and surfaces summary in recent()", async () => {
    const store = new SqliteMemoryRunsStore(await tempDbPath());
    store.recordStart({ id: "r1", sessionId: "s1", trigger: "auto" });
    await new Promise((r) => setTimeout(r, 5));
    const completed = store.recordComplete("r1", "wrote 1 fact");
    expect(completed.status).toBe("completed");
    expect(completed.summary).toBe("wrote 1 fact");
    expect((completed.msElapsed ?? 0)).toBeGreaterThanOrEqual(0);

    const recent = store.recent(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("r1");
  });

  test("records failure with error and optional child session id", async () => {
    const store = new SqliteMemoryRunsStore(await tempDbPath());
    store.recordStart({ id: "r2", sessionId: "s2", trigger: "explicit" });
    const failed = store.recordFail("r2", "boom", "sub-abc");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("boom");
    expect(failed.childSessionId).toBe("sub-abc");
  });

  test("recordStart is idempotent — bunqueue retries reuse the runId", async () => {
    const store = new SqliteMemoryRunsStore(await tempDbPath());
    const first = store.recordStart({ id: "r3", sessionId: "s", trigger: "auto" });
    // Simulate a retry hitting the same id — must not throw, must preserve
    // the original started_at.
    const again = store.recordStart({ id: "r3", sessionId: "s", trigger: "auto" });
    expect(again.startedAt).toBe(first.startedAt);
    // Subsequent complete still works.
    const completed = store.recordComplete("r3", "ok");
    expect(completed.status).toBe("completed");
  });

  test("recent returns most recent first", async () => {
    const store = new SqliteMemoryRunsStore(await tempDbPath());
    store.recordStart({ id: "a", sessionId: "s", trigger: "auto" });
    await new Promise((r) => setTimeout(r, 5));
    store.recordStart({ id: "b", sessionId: "s", trigger: "auto" });
    const order = store.recent(5).map((r) => r.id);
    expect(order).toEqual(["b", "a"]);
  });

  test("deletes runs related to sessions and resets all rows", async () => {
    const store = new SqliteMemoryRunsStore(await tempDbPath());
    store.recordStart({ id: "a", sessionId: "s1", trigger: "auto" });
    store.recordStart({ id: "b", sessionId: "s2", trigger: "auto" });
    store.recordFail("b", "boom", "sub-s1");
    store.recordStart({ id: "c", sessionId: "s3", trigger: "auto" });

    expect(store.deleteForSessions(["s1", "sub-s1"])).toBe(2);
    expect(store.recent(10).map((run) => run.id)).toEqual(["c"]);

    store.resetAll();
    expect(store.recent(10)).toEqual([]);
  });
});
