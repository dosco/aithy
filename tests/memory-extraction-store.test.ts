import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { SqliteMemoryExtractionStore } from "../src/memory/extraction-store";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { BotMessage } from "../src/session/types";

const stores: Array<{ close(): void }> = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe("SqliteMemoryExtractionStore", () => {
  test("tracks an idempotent monotonic auto cursor", async () => {
    const { extraction } = await fixture();

    expect(extraction.cursor()).toBe(0);
    extraction.setCursor(5);
    expect(extraction.cursor()).toBe(5);
    extraction.setCursor(3);
    expect(extraction.cursor()).toBe(5);
    extraction.setCursor(5);
    expect(extraction.cursor()).toBe(5);
    extraction.setCursor(8);
    expect(extraction.cursor()).toBe(8);
  });

  test("loads only messages after the cursor with bounded overlap", async () => {
    const { state, extraction } = await fixture();
    ensureSession(state, "main");
    state.appendMessages("main", [
      user("old user detail"),
      assistant("old assistant reply"),
      user("my favourite city is Vancouver"),
      assistant("I'll remember that."),
    ]);
    extraction.setCursor(2);

    const batch = extraction.loadBatch({ limit: 10, overlap: 1 });

    expect(batch.startCursor).toBe(2);
    expect(batch.nextCursor).toBe(4);
    expect(batch.inspectedCount).toBe(2);
    expect(batch.segments).toHaveLength(1);
    expect(batch.segments[0].messages.map((item) => item.kind)).toEqual(["context", "new", "new"]);
    expect(batch.segments[0].messages.map((item) => text(item.message))).toEqual([
      "old assistant reply",
      "my favourite city is Vancouver",
      "I'll remember that.",
    ]);
  });

  test("skips sub-session segments but reports a cursor past inspected rows", async () => {
    const { state, extraction } = await fixture();
    ensureSession(state, "main");
    ensureSession(state, "child", "main");
    state.appendMessages("child", [user("my favourite snack is apples")]);

    const batch = extraction.loadBatch({ limit: 10, overlap: 3 });

    expect(batch.inspectedCount).toBe(1);
    expect(batch.nextCursor).toBe(1);
    expect(batch.segments).toEqual([]);
  });
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-memory-extract-"));
  const dbPath = path.join(dir, "state.db");
  const state = new SqliteSessionStateStore(dbPath);
  const extraction = new SqliteMemoryExtractionStore(dbPath);
  stores.push(state, extraction);
  return { state, extraction };
}

function ensureSession(state: SqliteSessionStateStore, id: string, parentSessionId: string | null = null): void {
  state.ensureSession({
    conversationId: id,
    name: id,
    nameSource: "manual",
    source: "test",
    parentSessionId,
    parentMessageId: null,
    now: new Date().toISOString(),
    expiresAt: new Date("2099-01-01T00:00:00Z"),
  });
}

function user(content: string): BotMessage {
  return { role: "user", content, createdAt: new Date().toISOString() };
}

function assistant(content: string): BotMessage {
  return { role: "assistant", kind: "text", content, createdAt: new Date().toISOString() };
}

function text(message: BotMessage): string {
  return message.role === "user" ? message.content : message.kind === "text" ? message.content : "";
}
