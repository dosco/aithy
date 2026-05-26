import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/bus";
import { postToSubSessionAndFlush } from "../src/runtime/post-sub-session";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { LogicalSessionInput, MessagePage, MessagePageInput, SessionStateStore, StoredSession } from "../src/session/state-store";
import type { BotMessage, BotSessionSummary } from "../src/session/types";
import type { WebLiveEvent } from "../src/web/live-events";
import { LiveEventHub } from "../src/web/live-events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("postToSubSessionAndFlush", () => {
  test("flushes before returning the child message id", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-sub-"));
    const sandbox = new MockSandboxProvider();
    const state = new SqliteSessionStateStore(path.join(root, "state.db"));
    const sessions = new SessionManager({
      sandbox,
      botId: "default",
      workspaceRoot: root,
      events: new EventBus(),
      state,
    });
    sessions.ensureLogicalSession("parent");
    let flushed = false;

    const result = await postToSubSessionAndFlush(
      sessions,
      new LiveEventHub(),
      (input) => ({
        id: 1,
        read: false,
        createdAt: new Date().toISOString(),
        body: input.body ?? null,
        link: input.link ?? null,
        kind: input.kind,
        title: input.title,
        conversationId: input.conversationId ?? null,
        actionStatus: input.actionStatus ?? "none",
        actionExpiresAt: input.actionExpiresAt ?? null,
        resolvedAt: null,
      }),
      { parentSessionId: "parent", text: "child note", notify: false },
      async () => {
        flushed = true;
      },
    );

    expect(flushed).toBe(true);
    expect(result.sessionId).toStartWith("sub-");
    expect(result.messageId).toBe(1);
    state.close();
  });

  test("waits to publish sessions and notifications until the first message is flush-visible", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-sub-"));
    const state = new FlushVisibleStateStore();
    const sessions = new SessionManager({
      sandbox: new MockSandboxProvider(),
      botId: "default",
      workspaceRoot: root,
      events: new EventBus(),
      state,
    });
    sessions.ensureLogicalSession("parent", { name: "Parent" });
    const live = new LiveEventHub();
    const events: WebLiveEvent[] = [];
    const notifications: Array<{ link: string | null; visibleMessageId: number | null }> = [];
    live.subscribe((event) => events.push(event));
    let releaseFlush!: () => void;
    const flushGate = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });

    const pending = postToSubSessionAndFlush(
      sessions,
      live,
      (input) => {
        const sessionId = input.link?.split("/").at(-1) ?? "";
        notifications.push({
          link: input.link ?? null,
          visibleMessageId: sessions.lastMessageId(sessionId),
        });
        return {
          id: 1,
          read: false,
          createdAt: new Date().toISOString(),
          body: input.body ?? null,
          link: input.link ?? null,
          kind: input.kind,
          title: input.title,
          conversationId: input.conversationId ?? null,
          actionStatus: input.actionStatus ?? "none",
          actionExpiresAt: input.actionExpiresAt ?? null,
          resolvedAt: null,
        };
      },
      { parentSessionId: "parent", text: "child note", name: "Child" },
      async () => {
        await flushGate;
        state.flushPending();
      },
    );

    await Promise.resolve();
    expect(events).toHaveLength(0);
    expect(notifications).toHaveLength(0);

    releaseFlush();
    const result = await pending;

    expect(result.messageId).toBe(1);
    expect(events.filter((event) => event.type === "sessions")).toHaveLength(1);
    expect(notifications).toEqual([
      { link: `/chat/${result.sessionId}`, visibleMessageId: 1 },
    ]);
  });
});

class FlushVisibleStateStore implements SessionStateStore {
  private readonly summaries = new Map<string, BotSessionSummary>();
  private readonly committed = new Map<string, Array<{ id: number; message: BotMessage }>>();
  private readonly pending = new Map<string, Array<{ id: number; message: BotMessage }>>();
  private nextId = 1;

  ensureSession(input: LogicalSessionInput): void {
    if (this.summaries.has(input.conversationId)) return;
    const summary = summaryFromInput(input);
    this.summaries.set(input.conversationId, summary);
    this.committed.set(input.conversationId, []);
  }

  loadSession(conversationId: string): StoredSession | undefined {
    const summary = this.summaries.get(conversationId);
    if (!summary) return undefined;
    return {
      ...summary,
      messages: (this.committed.get(conversationId) ?? []).map((item) => item.message),
    };
  }

  listSessions(): BotSessionSummary[] {
    return [...this.summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  findSessionsByName(name: string): BotSessionSummary[] {
    return this.listSessions().filter((session) => session.name === name);
  }

  getSummary(conversationId: string): BotSessionSummary | undefined {
    return this.summaries.get(conversationId);
  }

  renameSession(conversationId: string, name: string): void {
    const summary = this.summaries.get(conversationId);
    if (summary) this.summaries.set(conversationId, { ...summary, name, nameSource: "manual" });
  }

  clearSession(conversationId: string, now: string): void {
    const summary = this.summaries.get(conversationId);
    if (summary) this.summaries.set(conversationId, { ...summary, updatedAt: now });
    this.committed.set(conversationId, []);
    this.pending.delete(conversationId);
  }

  deleteSession(conversationId: string): void {
    this.summaries.delete(conversationId);
    this.committed.delete(conversationId);
    this.pending.delete(conversationId);
  }

  deleteAllSessions(): void {
    this.summaries.clear();
    this.committed.clear();
    this.pending.clear();
  }

  appendMessages(conversationId: string, messages: BotMessage[]): void {
    const entries = this.pending.get(conversationId) ?? [];
    for (const message of messages) entries.push({ id: this.nextId++, message });
    this.pending.set(conversationId, entries);
    const summary = this.summaries.get(conversationId);
    const updatedAt = messages.at(-1)?.createdAt;
    if (summary && updatedAt) this.summaries.set(conversationId, { ...summary, updatedAt });
  }

  messagesPage(conversationId: string, input: MessagePageInput): MessagePage {
    const beforeId = input.beforeId ?? Number.POSITIVE_INFINITY;
    const available = (this.committed.get(conversationId) ?? []).filter((item) => item.id < beforeId);
    const items = available.slice(Math.max(0, available.length - input.limit));
    return {
      items,
      oldestId: items[0]?.id ?? null,
      newestId: items.at(-1)?.id ?? null,
      hasMoreBefore: available.length > items.length,
    };
  }

  childSessions(parentId: string): BotSessionSummary[] {
    return this.listSessions().filter((session) => session.parentSessionId === parentId);
  }

  lastMessageId(conversationId: string): number | null {
    return this.committed.get(conversationId)?.at(-1)?.id ?? null;
  }

  flushPending(): void {
    for (const [conversationId, entries] of this.pending) {
      const current = this.committed.get(conversationId) ?? [];
      this.committed.set(conversationId, [...current, ...entries]);
    }
    this.pending.clear();
  }
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
