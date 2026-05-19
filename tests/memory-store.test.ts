import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { MEMORY_KINDS } from "../src/memory/types";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-memory-"));
  return path.join(dir, "state.db");
}

describe("SqliteMemoryStore", () => {
  test("upsert stores and retrieves a memory", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const entry = store.upsert({
      kind: "fact",
      title: "user uses bun",
      body: "The user runs everything with bun, not node.",
      frequency: "daily",
      evidence: "User said they run everything with bun.",
      importance: 0.7,
    });
    expect(entry.id).toBeTruthy();
    expect(entry.kind).toBe("fact");
    expect(entry.importance).toBe(0.7);
    expect(store.count()).toBe(1);

    const fetched = store.get(entry.id);
    expect(fetched?.title).toBe("user uses bun");
    expect(fetched?.frequency).toBe("daily");
    expect(fetched?.evidence).toBe("User said they run everything with bun.");
    expect(fetched?.recallCount).toBe(0);
    expect(fetched?.retrievedCount).toBe(0);
  });

  test("search returns FTS matches and bumps retrieval counts", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    store.upsert({ kind: "fact", title: "uses bun runtime", body: "User runs bun." });
    store.upsert({ kind: "preference", title: "prefers tabs", body: "User prefers tabs over spaces." });

    const hits = await store.search(["bun"]);
    expect(hits.map((h) => h.title)).toEqual(["uses bun runtime"]);
    expect(hits[0].recallCount).toBe(0);
    expect(hits[0].retrievedCount).toBe(0);

    const second = await store.search(["bun"]);
    expect(second[0].recallCount).toBe(1);
    expect(second[0].retrievedCount).toBe(1);
  });

  test("search filters out excludeIds", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const a = store.upsert({ kind: "fact", title: "uses bun runtime", body: "User runs bun." });
    const b = store.upsert({ kind: "fact", title: "bun build flags", body: "User uses bun build with --bun flag." });

    const all = await store.search(["bun"]);
    expect(all.map((h) => h.id).sort()).toEqual([a.id, b.id].sort());

    const filtered = await store.search(["bun"], { excludeIds: [a.id] });
    expect(filtered.map((h) => h.id)).toEqual([b.id]);

    const both = await store.search(["bun"], { excludeIds: [a.id, b.id] });
    expect(both).toEqual([]);
  });

  test("search filters by kind", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    store.upsert({ kind: "fact", title: "bun fact", body: "fact about bun" });
    store.upsert({ kind: "preference", title: "bun preference", body: "prefers bun" });

    const facts = await store.search(["bun"], { kinds: ["fact"] });
    expect(facts.map((h) => h.kind)).toEqual(["fact"]);
  });

  test("stores and filters every memory kind", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    for (const kind of MEMORY_KINDS) {
      store.upsert({ kind, title: `${kind} marker`, body: `body for ${kind}` });
    }

    for (const kind of MEMORY_KINDS) {
      const page = store.page({ cursor: null, limit: 20, kind });
      expect(page.items.map((m) => m.kind)).toEqual([kind]);
    }
  });

  test("upsert stores time-bounded metadata and computes inclusive duration", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const entry = store.upsert({
      kind: "event",
      title: "Tokyo trip",
      body: "The user plans to visit Tokyo.",
      validFrom: "2026-05-10",
      validUntil: "2026-05-12",
      durationDays: 99,
      evidence: "User said the trip runs May 10 through May 12.",
    });

    expect(entry.validFrom).toBe("2026-05-10");
    expect(entry.validUntil).toBe("2026-05-12");
    expect(entry.durationDays).toBe(3);
    expect(entry.evidence).toContain("May 10");
  });

  test("upsert rejects invalid calendar dates", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    expect(() =>
      store.upsert({
        kind: "event",
        title: "bad date",
        body: "The user mentioned an impossible date.",
        validUntil: "2026-02-31",
      }),
    ).toThrow("validUntil must be an ISO date string");
  });

  test("search sanitizes empty / operator-like queries", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    store.upsert({ kind: "fact", title: "x", body: "y" });
    expect(await store.search([])).toEqual([]);
    expect(await store.search([""])).toEqual([]);
    await expect(store.search(["AND OR NOT"])).resolves.toEqual([]);
  });

  test("supersede chains old to new and excludes superseded from results", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const original = store.upsert({
      kind: "fact",
      title: "main repo",
      body: "Main repo is ~/src/old.",
    });
    const replacement = store.supersede(original.id, {
      kind: "fact",
      title: "main repo",
      body: "Main repo is ~/src/new.",
    });

    expect(store.get(original.id)?.supersededBy).toBe(replacement.id);
    const hits = await store.search(["repo"]);
    expect(hits.map((h) => h.id)).toEqual([replacement.id]);
  });

  test("recent returns most recently updated active memories", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const a = store.upsert({ kind: "fact", title: "a", body: "a" });
    await new Promise((r) => setTimeout(r, 5));
    const b = store.upsert({ kind: "fact", title: "b", body: "b" });
    const recent = store.recent(5);
    expect(recent.map((m) => m.id)).toEqual([b.id, a.id]);
  });

  test("delete removes a row", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const entry = store.upsert({ kind: "fact", title: "x", body: "y" });
    expect(store.delete(entry.id)).toBe(true);
    expect(store.delete(entry.id)).toBe(false);
    expect(store.count()).toBe(0);
  });

  test("body is capped at the byte limit", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const big = "x".repeat(10_000);
    const entry = store.upsert({ kind: "fact", title: "big", body: big });
    expect(entry.body.length).toBeLessThan(big.length);
    expect(entry.body.endsWith("[truncated]")).toBe(true);
  });

  test("importance is clamped to [0, 1]", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const high = store.upsert({ kind: "fact", title: "h", body: "h", importance: 5 });
    const low = store.upsert({ kind: "fact", title: "l", body: "l", importance: -1 });
    expect(high.importance).toBe(1);
    expect(low.importance).toBe(0);
  });

  test("page returns cursors and walks the dataset end-to-end", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    for (let i = 0; i < 5; i++) {
      store.upsert({ kind: "fact", title: `mem-${i}`, body: `body ${i}` });
      await new Promise((r) => setTimeout(r, 2));
    }
    const first = store.page({ cursor: null, limit: 2 });
    expect(first.items.map((m) => m.title)).toEqual(["mem-4", "mem-3"]);
    expect(first.nextCursor).not.toBeNull();

    const second = store.page({ cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((m) => m.title)).toEqual(["mem-2", "mem-1"]);

    const third = store.page({ cursor: second.nextCursor, limit: 2 });
    expect(third.items.map((m) => m.title)).toEqual(["mem-0"]);
    expect(third.nextCursor).toBeNull();
  });

  test("page can sort by retrieved count with a stable cursor", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    store.upsert({ kind: "fact", title: "alpha", body: "alpha" });
    await new Promise((r) => setTimeout(r, 2));
    store.upsert({ kind: "fact", title: "bravo", body: "bravo" });
    await new Promise((r) => setTimeout(r, 2));
    store.upsert({ kind: "fact", title: "charlie", body: "charlie" });

    await store.search(["alpha"]);
    await store.search(["bravo"]);
    await store.search(["bravo"]);

    const first = store.page({ cursor: null, limit: 2, sort: "retrieved" });
    expect(first.items.map((m) => `${m.title}:${m.retrievedCount}`)).toEqual([
      "bravo:2", "alpha:1",
    ]);

    const second = store.page({ cursor: first.nextCursor, limit: 2, sort: "retrieved" });
    expect(second.items.map((m) => `${m.title}:${m.retrievedCount}`)).toEqual(["charlie:0"]);
    expect(second.nextCursor).toBeNull();
  });

  test("page filters by query and kind together", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    store.upsert({ kind: "fact", title: "alpha bun", body: "x" });
    store.upsert({ kind: "preference", title: "beta bun", body: "y" });
    store.upsert({ kind: "fact", title: "gamma deno", body: "z" });

    const factsWithBun = store.page({ cursor: null, limit: 10, kind: "fact", query: "bun" });
    expect(factsWithBun.items.map((m) => m.title)).toEqual(["alpha bun"]);
    expect(factsWithBun.nextCursor).toBeNull();

    expect(store.count({ kind: "fact" })).toBe(2);
    expect(store.count({ query: "bun" })).toBe(2);
    expect(store.count({ kind: "preference", query: "bun" })).toBe(1);
  });

  test("mostRecent returns the latest non-superseded entry", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    expect(store.mostRecent()).toBeNull();
    store.upsert({ kind: "fact", title: "first", body: "a" });
    await new Promise((r) => setTimeout(r, 5));
    store.upsert({ kind: "fact", title: "latest", body: "b" });
    expect(store.mostRecent()?.title).toBe("latest");
  });

  test("resetAll clears memories and search index", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    store.upsert({ kind: "fact", title: "alpha bun", body: "bun memory" });
    expect(store.count()).toBe(1);

    store.resetAll();

    expect(store.count()).toBe(0);
    expect(await store.search(["bun"])).toEqual([]);
    expect(store.mostRecent()).toBeNull();
  });

  test("deleteExpired physically deletes only rows with valid_until before today", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    const expired = store.upsert({
      kind: "event",
      title: "old deadline",
      body: "The user's old deadline passed.",
      validUntil: "2026-05-09",
    });
    const today = store.upsert({
      kind: "event",
      title: "today deadline",
      body: "The user's deadline is today.",
      validUntil: "2026-05-10",
    });
    const future = store.upsert({
      kind: "event",
      title: "future deadline",
      body: "The user's deadline is tomorrow.",
      validUntil: "2026-05-11",
    });

    expect(store.deleteExpired("2026-05-10")).toBe(1);
    expect(store.get(expired.id)).toBeNull();
    expect(store.get(today.id)?.id).toBe(today.id);
    expect(store.get(future.id)?.id).toBe(future.id);
    expect(await store.search(["old deadline"])).toEqual([]);
  });

  test("migration maps episode to event and drops legacy tags", async () => {
    const dbPath = await tempDbPath();
    const db = new Database(dbPath, { create: true });
    db.exec(`
      CREATE TABLE schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (scope, version)
      );
      INSERT INTO schema_migrations(scope, version, applied_at)
      VALUES ('memory', 1, 'now'), ('memory', 2, 'now'), ('memory', 3, 'now'), ('memory', 4, 'now');
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'episode', 'instruction')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT,
        source TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_recalled_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0,
        retrieved_count INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT
      );
      INSERT INTO memories (
        id, kind, title, body, tags, source, importance, created_at, updated_at
      ) VALUES (
        'm1', 'episode', 'Tokyo trip', 'The user plans a Tokyo trip.', 'travel project misc', 'test', 0.6, '2026-01-01', '2026-01-01'
      );
    `);
    db.close();

    const store = new SqliteMemoryStore(dbPath);
    const migrated = store.get("m1");

    expect(migrated?.kind).toBe("event");
    expect(migrated?.validUntil).toBeNull();
    expect(await store.search(["travel"])).toEqual([]);
    store.close();

    const migratedDb = new Database(dbPath);
    const columns = migratedDb.query("PRAGMA table_info(memories)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain("labels");
    expect(columns.map((column) => column.name)).not.toContain("tags");
    migratedDb.close();
  });

  test("migration drops controlled labels from current memory schema", async () => {
    const dbPath = await tempDbPath();
    const db = new Database(dbPath, { create: true });
    db.exec(`
      CREATE TABLE schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (scope, version)
      );
      INSERT INTO schema_migrations(scope, version, applied_at)
      VALUES ('memory', 1, 'now'), ('memory', 2, 'now'), ('memory', 3, 'now'), ('memory', 4, 'now'), ('memory', 5, 'now'), ('memory', 6, 'now');
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'instruction', 'event')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        labels TEXT NOT NULL DEFAULT '[]',
        valid_from TEXT,
        valid_until TEXT,
        duration_days INTEGER,
        evidence TEXT,
        frequency TEXT,
        source TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_recalled_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0,
        retrieved_count INTEGER NOT NULL DEFAULT 0,
        superseded_by TEXT
      );
      INSERT INTO memories (
        id, kind, title, body, labels, source, importance, created_at, updated_at
      ) VALUES (
        'm1', 'fact', 'Main repo', 'The repo lives in ~/src/axbot.', '["project"]', 'test', 0.6, '2026-01-01', '2026-01-01'
      );
    `);
    db.close();

    const store = new SqliteMemoryStore(dbPath);
    const migrated = store.get("m1");

    expect(migrated?.kind).toBe("fact");
    expect(migrated?.body).toContain("~/src/axbot");
    expect(await store.search(["project"])).toEqual([]);
    store.close();
  });
});
