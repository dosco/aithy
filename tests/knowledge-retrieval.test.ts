import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteKnowledgeStore } from "../src/knowledge/knowledge-store";
import { MockEmbedder } from "./embed-mock";
import { MockReranker } from "./rerank-mock";

test("knowledge replaces chunks and uses mocked vector plus reranker search", async () => {
  const dbPath = path.join(await mkdtemp(path.join(tmpdir(), "aithy-knowledge-retrieval-")), "state.db");
  const embedder = new MockEmbedder([["restore service", "recover outage"]]);
  const reranker = new MockReranker({ relevantSubstrings: [["recover", "restore service"]] });
  const dirty: string[][] = [];
  const store = new SqliteKnowledgeStore(dbPath, { embedder, reranker, onDirtyIndex: ({ knowledge }) => dirty.push(knowledge) });
  const bundle = store.createBundle({ name: "Operations" });
  const doc = store.upsertConcept(bundle.id, { path: "recovery.md", type: "Runbook", title: "Service recovery", body: "Restore service from the last healthy release." });
  expect(dirty.at(-1)).toEqual([doc.id]);
  if (!store.isHybridReady()) { store.close(); return; }

  expect(store.embeddingStats().stale).toBeGreaterThan(0);
  expect(await store.indexEmbeddings([doc.id])).toMatchObject({ indexed: 1, failed: 0 });
  expect(store.embeddingStats().stale).toBe(0);
  expect((await store.searchSemantic("recover outage"))[0]?.id).toBe(doc.id);
  expect(store.isRerankReady()).toBe(true);

  store.upsertConcept(bundle.id, { id: doc.id, path: "recovery.md", type: "Runbook", title: "Service recovery", body: "Use the incident command checklist." });
  expect(store.embeddingStats().embedded).toBe(0);
  expect(await store.backfillEmbeddings()).toMatchObject({ done: 1 });
    expect(store.embeddingStats().stale).toBe(0);
    store.close();
  });
