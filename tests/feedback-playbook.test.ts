import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { SqliteFeedbackStore } from "../src/feedback/store";
import { PlaybookTooLargeError, ResponderPlaybookCache, ResponderPlaybookStore } from "../src/playbook/store";

describe("chat feedback and responder playbooks", () => {
  test("captures verified SQLite evidence and amends one row per assistant message", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-feedback-")); const dbPath = path.join(root, "state.db");
    const sessions = new SqliteSessionStateStore(dbPath); const now = new Date().toISOString();
    sessions.ensureSession({ conversationId: "chat", name: "Chat", nameSource: "manual", source: "web", model: null,
      systemPrompt: null, parentSessionId: null, parentMessageId: null, now, expiresAt: new Date(Date.now() + 60_000) });
    sessions.appendMessages("chat", [
      { role: "user", content: "Please be concise", createdAt: now },
      { role: "assistant", kind: "text", content: "A verified response", createdAt: now },
    ]);
    const messageId = sessions.lastMessageId("chat")!;
    const feedback = new SqliteFeedbackStore(dbPath);
    const first = feedback.upsert({ sessionId: "chat", messageId, verdict: "up" });
    expect(first).toMatchObject({ assistantResponse: "A verified response", precedingRequest: "Please be concise" });
    const amended = feedback.upsert({ sessionId: "chat", messageId, verdict: "down", comment: "Too terse" });
    expect(amended).toMatchObject({ id: first.id, verdict: "down", comment: "Too terse" });
    feedback.close(); sessions.close(); await rm(root, { recursive: true, force: true });
  });

  test("atomically caches bounded metadata snapshots and resets oversized learning", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-playbook-")); const dbPath = path.join(root, "state.db");
    const sessions = new SqliteSessionStateStore(dbPath); const store = new ResponderPlaybookStore(dbPath);
    const snapshot = { playbook: { sections: [] }, artifact: { history: [] } } as never;
    store.save(snapshot); const cache = new ResponderPlaybookCache(store);
    expect(cache.snapshot()).toEqual(snapshot);
    expect(() => store.save({ playbook: { text: "x".repeat(70_000) }, artifact: {} } as never)).toThrow(PlaybookTooLargeError);
    cache.reset(); expect(cache.snapshot()).toBeNull();
    store.close(); sessions.close(); await rm(root, { recursive: true, force: true });
  });
});
