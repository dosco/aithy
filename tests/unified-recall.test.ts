import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteEpisodeStore } from "../src/episodes/episode-store";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { unifiedMemoryRecall } from "../src/retrieval/memory-recall";
import { MockEmbedder } from "./embed-mock";
import { MockReranker } from "./rerank-mock";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-unified-recall-"));
  return path.join(dir, "state.db");
}

describe("unified memory recall", () => {
  test("fused fallback is not biased toward memories", async () => {
    const dbPath = await tempDbPath();
    const embedder = new MockEmbedder([["incident", "memory candidate", "episode candidate"]]);
    const memory = new SqliteMemoryStore(dbPath, { embedder });
    const episodes = new SqliteEpisodeStore(dbPath, { embedder });
    if (!memory.isHybridReady() || !episodes.isHybridReady()) return;

    memory.upsert({
      kind: "fact",
      title: "Incident note",
      body: "memory candidate",
      importance: 0.1,
    });
    episodes.upsert({
      task: "Handle incident",
      approach: "episode candidate",
      outcome: "success",
      importance: 0.9,
      sourceSessionId: "s1",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 2,
    });
    await memory.flushPendingEmbeds();
    await episodes.flushPendingEmbeds();

    const result = await unifiedMemoryRecall({ memory, episodes, queries: ["incident"], limit: 1 });
    expect(result.hits[0]?.source).toBe("episode");
    expect(result.diagnostics.mode).toBe("hybrid");
  });

  test("reranker can rank an episode above a memory", async () => {
    const dbPath = await tempDbPath();
    const embedder = new MockEmbedder([["incident", "episode winner"]]);
    const reranker = new MockReranker({ relevantSubstrings: [["incident", "episode winner"]] });
    const memory = new SqliteMemoryStore(dbPath, { embedder, reranker });
    const episodes = new SqliteEpisodeStore(dbPath, { embedder, reranker });
    if (!memory.isHybridReady() || !episodes.isHybridReady()) return;

    memory.upsert({ kind: "fact", title: "Incident preference", body: "The memory candidate is relevant." });
    episodes.upsert({
      task: "Recover incident",
      approach: "episode winner",
      outcome: "success",
      sourceSessionId: "s1",
      evidenceStartMessageId: 1,
      evidenceEndMessageId: 2,
    });
    await memory.flushPendingEmbeds();
    await episodes.flushPendingEmbeds();

    const result = await unifiedMemoryRecall({ memory, episodes, queries: ["incident"], limit: 2 });
    expect(result.hits[0]?.source).toBe("episode");
    expect(result.diagnostics.mode).toBe("hybrid-reranked");
    expect(result.diagnostics.sources.map((source) => source.source).sort()).toEqual(["episodes", "memories"]);
  });
});
