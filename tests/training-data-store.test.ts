import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { safeGetChatLog } from "../src/agent/run-message-helpers";
import { normalizeChatLogEntries } from "../src/training-data/normalize";
import { SqliteTrainingDataStore } from "../src/training-data/store";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-training-data-"));
  return path.join(dir, "state.db");
}

const flatEntry = {
  name: "distiller",
  model: "gpt-test",
  stage: "ctx" as const,
  sessionId: "ax-session",
  remoteId: "remote",
  remoteRequestId: "request",
  remoteSessionId: "remote-session",
  providerMetadata: { openai: { provider: "openai" } },
  modelUsage: { ai: "openai", model: "gpt-test", promptTokens: 3, completionTokens: 2, totalTokens: 5 },
  messages: [
    { role: "system" as const, content: "system" },
    { role: "user" as const, content: "hello" },
    { role: "assistant" as const, content: "hi" },
  ],
};

describe("training data trace normalization", () => {
  test("accepts Ax flat chat logs and preserves trace metadata", () => {
    const entries = safeGetChatLog({ getChatLog: () => [flatEntry] });
    expect(entries).toHaveLength(1);

    const [normalized] = normalizeChatLogEntries({
      sessionId: "session-1",
      runId: "run-1",
      entries,
      createdAt: "2026-05-25T00:00:00.000Z",
    });

    expect(normalized).toMatchObject({
      sessionId: "session-1",
      runId: "run-1",
      component: "chat.responder",
      stage: "ctx",
      name: "distiller",
      model: "gpt-test",
      axSessionId: "ax-session",
      remoteId: "remote",
      remoteRequestId: "request",
      remoteSessionId: "remote-session",
      providerMetadata: { openai: { provider: "openai" } },
      modelUsage: { ai: "openai", model: "gpt-test", promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      messages: flatEntry.messages,
    });
  });

  test("keeps legacy split chat logs readable during migration", () => {
    const entries = safeGetChatLog({
      getChatLog: () => ({
        actor: [{ ...flatEntry, name: "executor", stage: "task" }],
        responder: [flatEntry],
      }),
    });
    expect(entries.map((entry) => entry.name)).toEqual(["executor", "distiller"]);
  });
});

describe("SqliteTrainingDataStore", () => {
  test("stores traces and exports SFT JSONL", async () => {
    const store = new SqliteTrainingDataStore(await tempDbPath());
    store.recordChatLog({ sessionId: "s1", runId: "r1", entries: [flatEntry] });

    expect(store.summary()).toMatchObject({
      traceCount: 1,
      sftExampleCount: 1,
      preferencePairCount: 0,
      sessionCount: 1,
      byComponent: [{ key: "chat.responder", stage: "ctx", count: 1 }],
      byModel: [{ key: "gpt-test", stage: null, count: 1 }],
      bySession: [{ key: "s1", stage: null, count: 1 }],
    });

    const [line] = store.exportSftJsonl().trim().split("\n");
    expect(JSON.parse(line!)).toEqual({ messages: flatEntry.messages });
    store.close();
  });

  test("exports explicit DPO pairs only", async () => {
    const store = new SqliteTrainingDataStore(await tempDbPath());
    store.recordPreferencePair({
      sessionId: "s1",
      promptMessages: [{ role: "user", content: "hello" }],
      chosenMessages: [{ role: "assistant", content: "good" }],
      rejectedMessages: [{ role: "assistant", content: "bad" }],
      source: "feedback",
    });

    const [line] = store.exportDpoJsonl().trim().split("\n");
    expect(JSON.parse(line!)).toEqual({
      prompt: [{ role: "user", content: "hello" }],
      chosen: [{ role: "assistant", content: "good" }],
      rejected: [{ role: "assistant", content: "bad" }],
    });
    store.close();
  });

  test("migrates the training data schema independently", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteTrainingDataStore(dbPath);
    store.close();

    const db = new Database(dbPath, { readonly: true });
    const scopes = db.query(`
      SELECT scope, version FROM schema_migrations WHERE scope = 'training_data'
    `).all() as Array<{ scope: string; version: number }>;
    expect(scopes).toEqual([{ scope: "training_data", version: 1 }]);
    db.close();
  });
});
