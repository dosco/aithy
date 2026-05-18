import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteEpisodeStore } from "../src/episodes/episode-store";
import { MockEmbedder } from "./embed-mock";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-episodes-"));
  return path.join(dir, "state.db");
}

describe("SqliteEpisodeStore", () => {
  test("tracks a monotonic dream cursor", async () => {
    const store = new SqliteEpisodeStore(await tempDbPath());
    expect(store.cursor()).toBe(0);
    store.setCursor(5);
    store.setCursor(3);
    store.setCursor(8);
    expect(store.cursor()).toBe(8);
    store.close();
  });

  test("upsert dedupes canonical episodes and updates seen count", async () => {
    const store = new SqliteEpisodeStore(await tempDbPath());
    const first = store.upsert({
      task: "Run bun tests",
      approach: "Ran the targeted Bun test file first.",
      outcome: "success",
      notes: "Targeted tests were enough before broader checks.",
      toolNames: ["sandbox.bash"],
      sourceSessionId: "s1",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 2,
      canonicalText: "repo bun test flow",
      importance: 0.7,
    });
    const second = store.upsert({
      task: "Run Bun tests",
      approach: "Used the same targeted Bun test flow.",
      outcome: "success",
      notes: "The repeat confirmed this is the normal test path.",
      toolNames: ["sandbox.bash"],
      sourceSessionId: "s2",
      evidenceStartMessageId: 5,
      evidenceEndMessageId: 6,
      canonicalText: "repo bun test flow",
      importance: 0.8,
    });

    expect(second.id).toBe(first.id);
    expect(store.count()).toBe(1);
    expect(store.get(first.id)).toMatchObject({
      seenCount: 2,
      sourceSessionId: "s2",
      evidenceStartMessageId: 5,
      evidenceEndMessageId: 6,
      importance: 0.8,
    });
    store.close();
  });

  test("empty canonical text falls back to task and approach for dedupe", async () => {
    const store = new SqliteEpisodeStore(await tempDbPath());
    const first = store.upsert({
      task: "Debug postgres timeout",
      approach: "Ran the postgres test directly.",
      outcome: "success",
      sourceSessionId: "s1",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 2,
      canonicalText: "",
    });
    const second = store.upsert({
      task: "Create release notes",
      approach: "Summarized the merged changes.",
      outcome: "success",
      sourceSessionId: "s2",
      evidenceStartMessageId: 3,
      evidenceEndMessageId: 4,
      canonicalText: "",
    });

    expect(second.id).not.toBe(first.id);
    expect(store.count()).toBe(2);
    store.close();
  });

  test("search returns FTS matches and bumps retrieval counters", async () => {
    const store = new SqliteEpisodeStore(await tempDbPath());
    store.upsert({
      task: "Debug postgres timezone test",
      approach: "Checked the failing test and ran a targeted postgres command.",
      outcome: "success",
      notes: "Target the failing database test before broad suites.",
      toolNames: ["sandbox.bash"],
      sourceSessionId: "s1",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 3,
    });

    const first = await store.search(["postgres timezone"]);
    expect(first.map((episode) => episode.task)).toEqual(["Debug postgres timezone test"]);
    expect(first[0].retrievedCount).toBe(0);

    const second = await store.search(["postgres timezone"]);
    expect(second[0].retrievedCount).toBe(1);
    store.close();
  });

  test("hybrid search can find semantic matches when sqlite-vec is available", async () => {
    const embedder = new MockEmbedder([
      ["postgres", "pg database"],
    ]);
    const store = new SqliteEpisodeStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) {
      store.close();
      return;
    }

    store.upsert({
      task: "Debug postgres timeout",
      approach: "Inspected the postgres test and reran it directly.",
      outcome: "partial",
      notes: "The targeted database path gave a useful failure.",
      sourceSessionId: "s1",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 2,
    });
    await store.flushPendingEmbeds();

    const hits = await store.search(["pg database"]);
    expect(hits[0]?.task).toBe("Debug postgres timeout");
    store.close();
  });

  test("resetAll clears stale episode vectors even from a non-embedding store", async () => {
    const dbPath = await tempDbPath();
    const embedder = new MockEmbedder([
      ["legacy semantic", "legacy query"],
      ["fresh semantic", "fresh query"],
    ]);
    const seeded = new SqliteEpisodeStore(dbPath, { embedder });
    if (!seeded.isHybridReady()) {
      seeded.close();
      return;
    }

    seeded.upsert({
      task: "Legacy semantic task",
      approach: "Used the legacy semantic approach.",
      outcome: "success",
      notes: "This should disappear after reset.",
      sourceSessionId: "s1",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 2,
    });
    await seeded.flushPendingEmbeds();
    seeded.close();

    const resetter = new SqliteEpisodeStore(dbPath);
    resetter.resetAll();
    resetter.close();

    const fresh = new SqliteEpisodeStore(dbPath, { embedder, inlineEmbeds: false });
    fresh.upsert({
      task: "Fresh unrelated task",
      approach: "Used the fresh semantic approach.",
      outcome: "success",
      notes: "No legacy vector should point at this row.",
      sourceSessionId: "s2",
      evidenceStartMessageId: 3,
      evidenceEndMessageId: 4,
    });

    const staleHits = await fresh.search(["legacy query"]);
    expect(staleHits).toEqual([]);
    fresh.close();
  });
});
