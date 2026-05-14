import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { QueueSessionCache } from "../src/runtime/services/queue/session-cache";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type {
  LogicalSessionInput,
  MessagePageInput,
  SessionStateStore,
  StoredSession,
} from "../src/session/state-store";
import type { BotMessage, BotSessionSummary } from "../src/session/types";
import type { WebLiveEvent } from "../src/web/live-events";

describe("QueueSessionCache", () => {
  test("serves cached session reads and invalidates message pages on mutation", async () => {
    const { cache, store, events } = await testCache();
    cache.ensure(logicalSession("s1", "First"));
    expect(cache.list().map((session) => session.conversationId)).toEqual(["s1"]);

    expect(cache.load("s1")?.name).toBe("First");
    expect(cache.load("s1")?.name).toBe("First");
    expect(store.calls.loadSession).toBe(1);

    const tailPage = { limit: 50 };
    cache.appendMessages("s1", [userMessage("hello")]);
    expect(cache.messagesPage("s1", tailPage).items).toHaveLength(1);
    expect(cache.messagesPage("s1", tailPage).items).toHaveLength(1);
    expect(store.calls.messagesPage).toBe(1);
    expect(events.some((event) => event.type === "message")).toBe(true);

    cache.appendMessages("s1", [assistantMessage("hi")]);
    expect(cache.messagesPage("s1", tailPage).items).toHaveLength(2);
    expect(store.calls.messagesPage).toBe(2);

    expect(cache.rename("s1", "Renamed")?.name).toBe("Renamed");
    expect(cache.summary("s1")?.name).toBe("Renamed");

    cache.clear("s1", new Date().toISOString());
    expect(cache.messagesPage("s1", tailPage).items).toHaveLength(0);

    cache.delete("s1");
    expect(cache.summary("s1")).toBeUndefined();
  });

  test("restores sessions and messages from SQLite after restart", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-queue-cache-"));
    const dbPath = path.join(dir, "state.db");
    const first = new QueueSessionCache(new SqliteSessionStateStore(dbPath), () => {});
    first.ensure(logicalSession("persisted", "Persisted"));
    first.appendMessages("persisted", [userMessage("keep me")]);
    first.close();

    const second = new QueueSessionCache(new SqliteSessionStateStore(dbPath), () => {});
    expect(second.list().map((session) => session.conversationId)).toEqual(["persisted"]);
    expect(second.load("persisted")?.messages).toHaveLength(1);
    second.close();
  });

  test("does not publish a child session until its first message is readable", async () => {
    const { cache, events } = await testCache();
    cache.ensure(logicalSession("parent", "Parent"));
    events.length = 0;

    cache.ensure(logicalSession("child", "Child", { parentSessionId: "parent" }));
    expect(events.filter((event) => event.type === "sessions")).toHaveLength(0);

    cache.appendMessages("child", [assistantMessage("ready")]);
    const sessionEvents = events.filter((event) => event.type === "sessions");
    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0].sessions.some((session) => session.conversationId === "child")).toBe(true);
    expect(cache.messagesPage("child", { limit: 50 }).items).toHaveLength(1);
  });
});

class CountingSessionStore implements SessionStateStore {
  readonly calls = { loadSession: 0, messagesPage: 0 };

  constructor(private readonly inner: SessionStateStore) {}

  ensureSession(input: LogicalSessionInput): void {
    this.inner.ensureSession(input);
  }

  loadSession(conversationId: string): StoredSession | undefined {
    this.calls.loadSession += 1;
    return this.inner.loadSession(conversationId);
  }

  listSessions(): BotSessionSummary[] {
    return this.inner.listSessions();
  }

  findSessionsByName(name: string): BotSessionSummary[] {
    return this.inner.findSessionsByName(name);
  }

  getSummary(conversationId: string): BotSessionSummary | undefined {
    return this.inner.getSummary(conversationId);
  }

  renameSession(conversationId: string, name: string): void {
    this.inner.renameSession(conversationId, name);
  }

  clearSession(conversationId: string, now: string): void {
    this.inner.clearSession(conversationId, now);
  }

  deleteSession(conversationId: string): void {
    this.inner.deleteSession(conversationId);
  }

  deleteAllSessions(): void {
    this.inner.deleteAllSessions();
  }

  appendMessages(conversationId: string, messages: BotMessage[]): void {
    this.inner.appendMessages(conversationId, messages);
  }

  messagesPage(conversationId: string, input: MessagePageInput) {
    this.calls.messagesPage += 1;
    return this.inner.messagesPage(conversationId, input);
  }

  childSessions(parentId: string): BotSessionSummary[] {
    return this.inner.childSessions(parentId);
  }

  lastMessageId(conversationId: string): number | null {
    return this.inner.lastMessageId(conversationId);
  }

  close(): void {
    this.inner.close?.();
  }
}

async function testCache() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-queue-cache-"));
  const store = new CountingSessionStore(new SqliteSessionStateStore(path.join(dir, "state.db")));
  const events: WebLiveEvent[] = [];
  const cache = new QueueSessionCache(store, (event) => events.push(event));
  return { cache, store, events };
}

function logicalSession(
  conversationId: string,
  name: string,
  options: { parentSessionId?: string | null } = {},
): LogicalSessionInput {
  const now = new Date().toISOString();
  return {
    conversationId,
    name,
    nameSource: "generated",
    source: "web",
    parentSessionId: options.parentSessionId ?? null,
    now,
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function userMessage(content: string): BotMessage {
  return { role: "user", content, createdAt: new Date().toISOString() };
}

function assistantMessage(content: string): BotMessage {
  return { role: "assistant", kind: "text", content, createdAt: new Date().toISOString() };
}
