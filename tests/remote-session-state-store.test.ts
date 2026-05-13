import { describe, expect, test } from "bun:test";
import { RemoteSessionStateStore } from "../src/runtime/services/queue/session-state-client";
import type { QueueServiceClient } from "../src/runtime/services/queue/client";
import type { LogicalSessionInput, MessagePage, MessagePageInput, StoredSession } from "../src/session/state-store";
import type { BotMessage, BotSessionSummary } from "../src/session/types";

describe("RemoteSessionStateStore", () => {
  test("tracks last message ids after queued remote appends flush", async () => {
    const client = new FakeQueueServiceClient();
    const store = new RemoteSessionStateStore(client as unknown as QueueServiceClient);

    store.ensureSession(logicalSession("remote", "Remote"));
    await store.flush();
    store.appendMessages("remote", [
      userMessage("hello"),
      assistantMessage("hi"),
    ]);

    expect(store.lastMessageId("remote")).toBeNull();
    await store.flush();

    expect(store.lastMessageId("remote")).toBe(2);
    expect(store.loadSession("remote")?.messages).toHaveLength(2);
  });

  test("hydrates and clears remote last message ids with message pages", async () => {
    const client = new FakeQueueServiceClient();
    await client.ensureSession(logicalSession("remote", "Remote"));
    await client.appendMessages("remote", [
      userMessage("first"),
      assistantMessage("second"),
    ]);
    const store = new RemoteSessionStateStore(client as unknown as QueueServiceClient);

    await store.preloadMessages("remote", { limit: 50 });
    expect(store.lastMessageId("remote")).toBe(2);

    store.clearSession("remote", new Date("2026-04-30T00:00:00Z").toISOString());
    expect(store.lastMessageId("remote")).toBeNull();
    await store.flush();
    expect(store.lastMessageId("remote")).toBeNull();
  });
});

class FakeQueueServiceClient {
  private readonly sessions = new Map<string, BotSessionSummary>();
  private readonly messages = new Map<string, Array<{ id: number; message: BotMessage }>>();
  private nextId = 1;

  async listSessions(): Promise<BotSessionSummary[]> {
    return [...this.sessions.values()];
  }

  async ensureSession(input: LogicalSessionInput): Promise<BotSessionSummary> {
    const existing = this.sessions.get(input.conversationId);
    if (existing) return existing;
    const summary = summaryFromInput(input);
    this.sessions.set(input.conversationId, summary);
    this.messages.set(input.conversationId, []);
    return summary;
  }

  async loadSession(conversationId: string): Promise<StoredSession | undefined> {
    const summary = this.sessions.get(conversationId);
    if (!summary) return undefined;
    return {
      ...summary,
      messages: (this.messages.get(conversationId) ?? []).map((item) => item.message),
    };
  }

  async sessionSummary(conversationId: string): Promise<BotSessionSummary | undefined> {
    return this.sessions.get(conversationId);
  }

  async renameSession(conversationId: string, name: string): Promise<BotSessionSummary | undefined> {
    const summary = this.sessions.get(conversationId);
    if (!summary) return undefined;
    const next = { ...summary, name, nameSource: "manual" as const };
    this.sessions.set(conversationId, next);
    return next;
  }

  async clearSession(conversationId: string, now: string): Promise<BotSessionSummary> {
    const summary = this.sessions.get(conversationId) ?? summaryFromInput(logicalSession(conversationId, "New Chat"));
    const next = {
      ...summary,
      updatedAt: now,
      tokenTotals: { input: 0, output: 0, thought: 0, total: 0 },
    };
    this.sessions.set(conversationId, next);
    this.messages.set(conversationId, []);
    return next;
  }

  async deleteSession(conversationId: string): Promise<void> {
    this.sessions.delete(conversationId);
    this.messages.delete(conversationId);
  }

  async deleteAllSessions(): Promise<void> {
    this.sessions.clear();
    this.messages.clear();
  }

  async appendMessages(conversationId: string, messages: BotMessage[]): Promise<MessagePage> {
    if (!this.sessions.has(conversationId)) await this.ensureSession(logicalSession(conversationId, "Remote"));
    const existing = this.messages.get(conversationId) ?? [];
    for (const message of messages) existing.push({ id: this.nextId++, message });
    this.messages.set(conversationId, existing);
    return this.messagesPage(conversationId, { limit: 50 });
  }

  async messagesPage(conversationId: string, input: MessagePageInput): Promise<MessagePage> {
    const limit = Math.max(0, input.limit);
    const beforeId = input.beforeId ?? Number.POSITIVE_INFINITY;
    const available = (this.messages.get(conversationId) ?? []).filter((item) => item.id < beforeId);
    const items = available.slice(Math.max(0, available.length - limit));
    return {
      items,
      oldestId: items[0]?.id ?? null,
      newestId: items.at(-1)?.id ?? null,
      hasMoreBefore: available.length > items.length,
    };
  }

  async childSessions(parentId: string): Promise<BotSessionSummary[]> {
    return [...this.sessions.values()].filter((session) => session.parentSessionId === parentId);
  }

  async lastMessageId(conversationId: string): Promise<number | null> {
    return this.messages.get(conversationId)?.at(-1)?.id ?? null;
  }
}

function logicalSession(conversationId: string, name: string): LogicalSessionInput {
  const now = new Date("2026-04-30T00:00:00Z").toISOString();
  return {
    conversationId,
    name,
    nameSource: "generated",
    source: "web",
    now,
    expiresAt: new Date("2026-05-01T00:00:00Z"),
  };
}

function summaryFromInput(input: LogicalSessionInput): BotSessionSummary {
  return {
    conversationId: input.conversationId,
    name: input.name,
    nameSource: input.nameSource,
    source: input.source,
    model: input.model ?? null,
    systemPrompt: input.systemPrompt ?? null,
    parentSessionId: input.parentSessionId ?? null,
    parentMessageId: input.parentMessageId ?? null,
    tokenTotals: { input: 0, output: 0, thought: 0, total: 0 },
    createdAt: input.now,
    updatedAt: input.now,
    expiresAt: input.expiresAt,
  };
}

function userMessage(content: string): BotMessage {
  return { role: "user", content, createdAt: new Date("2026-04-30T00:00:00Z").toISOString() };
}

function assistantMessage(content: string): BotMessage {
  return {
    role: "assistant",
    kind: "text",
    content,
    createdAt: new Date("2026-04-30T00:00:01Z").toISOString(),
  };
}
