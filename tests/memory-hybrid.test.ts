import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { MockEmbedder } from "./embed-mock";
import { MockReranker } from "./rerank-mock";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-hybrid-"));
  return path.join(dir, "state.db");
}

describe("hybrid memory retrieval", () => {
  test("falls back to FTS-only when no embedder is provided", async () => {
    const store = new SqliteMemoryStore(await tempDbPath());
    expect(store.isHybridReady()).toBe(false);

    store.upsert({ kind: "fact", title: "uses bun runtime", body: "User runs bun." });
    const hits = await store.search(["bun"]);
    expect(hits.map((h) => h.title)).toEqual(["uses bun runtime"]);
  });

  test("hybrid mode embeds memories on write", async () => {
    const embedder = new MockEmbedder();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) {
      // Environment without extension-enabled SQLite — skip the hybrid checks.
      // The fallback above already covers FTS-only behavior.
      console.warn("hybrid not available — skipping vec-side assertions");
      return;
    }

    store.upsert({ kind: "fact", title: "postgres timezone gotcha", body: "TZ defaults bite." });
    await store.flushPendingEmbeds();

    const probe = probeVecRowCount(store);
    expect(probe).toBe(1);
  });

  test("synonym query finds semantic match the FTS5 path would miss", async () => {
    const embedder = new MockEmbedder([
      ["postgres", "psql", "pg database"],
    ]);
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) return;

    store.upsert({ kind: "fact", title: "postgres timezone gotcha", body: "TZ default UTC." });
    store.upsert({ kind: "fact", title: "python virtualenv", body: "Use venv per project." });
    await store.flushPendingEmbeds();

    const hybridHits = await store.search(["pg database tz"]);
    const titles = hybridHits.map((h) => h.title);
    expect(titles).toContain("postgres timezone gotcha");
    expect(titles[0]).toBe("postgres timezone gotcha");
  });

  test("hybrid filters superseded memories", async () => {
    const embedder = new MockEmbedder();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) return;

    const original = store.upsert({ kind: "fact", title: "main repo", body: "old path" });
    const replacement = store.supersede(original.id, {
      kind: "fact",
      title: "main repo",
      body: "new path",
    });
    await store.flushPendingEmbeds();

    const hits = await store.search(["repo"]);
    expect(hits.map((h) => h.id)).toEqual([replacement.id]);
  });

  test("hybrid respects kinds filter", async () => {
    const embedder = new MockEmbedder();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) return;

    store.upsert({ kind: "fact", title: "bun fact", body: "fact about bun" });
    store.upsert({ kind: "preference", title: "bun preference", body: "prefers bun" });
    await store.flushPendingEmbeds();

    const facts = await store.search(["bun"], { kinds: ["fact"] });
    expect(facts.every((h) => h.kind === "fact")).toBe(true);
  });

  test("delete removes the vec row", async () => {
    const embedder = new MockEmbedder();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) return;

    const entry = store.upsert({ kind: "fact", title: "x", body: "y" });
    await store.flushPendingEmbeds();
    expect(probeVecRowCount(store)).toBe(1);

    store.delete(entry.id);
    expect(probeVecRowCount(store)).toBe(0);
  });

  test("backfill embeds memories that were written before the embedder was wired", async () => {
    const dbPath = await tempDbPath();
    const stub = new SqliteMemoryStore(dbPath);
    stub.upsert({ kind: "fact", title: "a", body: "first" });
    stub.upsert({ kind: "fact", title: "b", body: "second" });
    stub.upsert({ kind: "fact", title: "c", body: "third" });

    const embedder = new MockEmbedder();
    const store = new SqliteMemoryStore(dbPath, { embedder });
    if (!store.isHybridReady()) return;

    expect(probeVecRowCount(store)).toBe(0);
    const result = await store.backfillEmbeddings();
    expect(result.done).toBe(3);
    expect(probeVecRowCount(store)).toBe(3);

    const second = await store.backfillEmbeddings();
    expect(second.done).toBe(0);
    expect(second.skipped).toBe(3);
  });

  test("vec leg failure degrades to FTS-only without throwing", async () => {
    const embedder = new MockEmbedder();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) return;

    store.upsert({ kind: "fact", title: "uses bun runtime", body: "User runs bun." });
    await store.flushPendingEmbeds();

    embedder.setUnavailable("simulated runtime failure");
    expect(store.isHybridReady()).toBe(false);

    const hits = await store.search(["bun"]);
    expect(hits.map((h) => h.title)).toEqual(["uses bun runtime"]);
  });

  test("reranker is wired in when provided and ready", async () => {
    const embedder = new MockEmbedder();
    const reranker = new MockReranker();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder, reranker });
    if (!store.isHybridReady()) return;
    expect(store.isRerankReady()).toBe(true);
  });

  test("reranker re-orders RRF candidates by cross-encoder score", async () => {
    // The mock reranker boosts pairs where the query contains "pg" and the
    // doc contains "postgres". Without rerank, the embedding-synonym path
    // would still surface postgres first, so we make this test deterministic
    // by adding a high-importance distractor that the RRF + multiplier
    // would otherwise keep on top.
    const embedder = new MockEmbedder();
    const reranker = new MockReranker({
      relevantSubstrings: [["pg", "postgres"]],
    });
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder, reranker });
    if (!store.isRerankReady()) return;

    // Distractor with very high importance + recency that wins under the
    // RRF + importance×recency formula (multiplier ~2 × ~1). Crucially the
    // body does NOT contain "postgres", so the mock reranker's synonym
    // table won't fire on this row.
    store.upsert({
      kind: "fact",
      title: "pg unrelated",
      body: "this row mentions pg as an abbreviation, nothing relevant here",
      importance: 1.0,
    });
    // Real target — gets rerank boost via the synonym table because both
    // title and body contain "postgres".
    store.upsert({
      kind: "fact",
      title: "postgres timezone gotcha",
      body: "tz default UTC trips up everyone in postgres",
      importance: 0.3,
    });
    await store.flushPendingEmbeds();

    const hits = await store.search(["pg"]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toBe("postgres timezone gotcha");
  });

  test("excludeIds drops already-loaded memories from hybrid results", async () => {
    const embedder = new MockEmbedder();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) return;

    const a = store.upsert({ kind: "fact", title: "uses bun runtime", body: "User runs bun." });
    const b = store.upsert({ kind: "fact", title: "bun build flags", body: "User uses bun build with --bun flag." });
    await store.flushPendingEmbeds();

    const all = await store.search(["bun"]);
    expect(all.map((h) => h.id).sort()).toEqual([a.id, b.id].sort());

    const filtered = await store.search(["bun"], { excludeIds: [a.id] });
    expect(filtered.map((h) => h.id)).toEqual([b.id]);
  });

  test("excludeIds drops already-loaded memories from reranked results", async () => {
    const embedder = new MockEmbedder();
    const reranker = new MockReranker();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder, reranker });
    if (!store.isRerankReady()) return;

    const a = store.upsert({ kind: "fact", title: "postgres timezone gotcha", body: "tz default UTC." });
    const b = store.upsert({ kind: "fact", title: "postgres connection pooling", body: "use pgbouncer." });
    await store.flushPendingEmbeds();

    const all = await store.search(["postgres"]);
    expect(all.map((h) => h.id).sort()).toEqual([a.id, b.id].sort());

    const filtered = await store.search(["postgres"], { excludeIds: [a.id] });
    expect(filtered.map((h) => h.id)).toEqual([b.id]);
  });

  test("rerank failure falls back to RRF + importance/recency without throwing", async () => {
    const embedder = new MockEmbedder();
    const reranker = new MockReranker();
    const store = new SqliteMemoryStore(await tempDbPath(), { embedder, reranker });
    if (!store.isRerankReady()) return;

    store.upsert({ kind: "fact", title: "uses bun runtime", body: "User runs bun." });
    await store.flushPendingEmbeds();

    reranker.setUnavailable("simulated rerank failure");
    expect(store.isRerankReady()).toBe(false);

    // Hybrid should still work — only the rerank step is skipped.
    const hits = await store.search(["bun"]);
    expect(hits.map((h) => h.title)).toEqual(["uses bun runtime"]);
  });
});

function probeVecRowCount(store: SqliteMemoryStore): number {
  const row = (store as unknown as { db: { query: (sql: string) => { get: () => { c: number } } } })
    .db.query("SELECT COUNT(*) AS c FROM memories_vec")
    .get();
  return row?.c ?? 0;
}
