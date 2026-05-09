import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteMemoryStore } from "../src/memory/memory-store";

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
      tags: "runtime bun",
      importance: 0.7,
    });
    expect(entry.id).toBeTruthy();
    expect(entry.kind).toBe("fact");
    expect(entry.importance).toBe(0.7);
    expect(store.count()).toBe(1);

    const fetched = store.get(entry.id);
    expect(fetched?.title).toBe("user uses bun");
    expect(fetched?.recallCount).toBe(0);
  });

  test("search returns FTS matches and bumps recall_count", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    store.upsert({ kind: "fact", title: "uses bun runtime", body: "User runs bun.", tags: "bun" });
    store.upsert({ kind: "preference", title: "prefers tabs", body: "User prefers tabs over spaces.", tags: "style" });

    const hits = await store.search(["bun"]);
    expect(hits.map((h) => h.title)).toEqual(["uses bun runtime"]);
    expect(hits[0].recallCount).toBe(0);

    const second = await store.search(["bun"]);
    expect(second[0].recallCount).toBe(1);
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
      tags: "repo path",
    });
    const replacement = store.supersede(original.id, {
      kind: "fact",
      title: "main repo",
      body: "Main repo is ~/src/new.",
      tags: "repo path",
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
});
