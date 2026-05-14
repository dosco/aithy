import { describe, expect, test } from "bun:test";
import { sessionMessagesPageState } from "../app/server/session-messages.functions";
import type { MessagePage, MessagePageInput, SessionStateStore, StoredSession } from "../src/session/state-store";
import type { BotMessage, BotSessionSummary } from "../src/session/types";

describe("sessionMessagesPageState", () => {
  test("does not create an unknown session while loading messages", async () => {
    const state = new FakeSessionState();
    const runtime = {
      sessionState: state,
      sessions: {
        getSummary: (id: string) => state.getSummary(id),
        messagesPage: (id: string, input: MessagePageInput) => state.messagesPage(id, input),
      },
    };

    const page = await sessionMessagesPageState(runtime as any, {
      conversationId: "missing",
      beforeId: null,
      limit: 10,
    });

    expect(page.items).toEqual([]);
    expect(state.created).toBe(false);
    expect(state.preloaded).toEqual(["missing"]);
  });

  test("retries an empty child session page while the first message catches up", async () => {
    const state = new FakeSessionState();
    state.addSummary("child", "Child", "parent");
    state.showMessageOnPreloadAttempt = 2;
    const runtime = {
      sessionState: state,
      sessions: {
        getSummary: (id: string) => state.getSummary(id),
        messagesPage: (id: string, input: MessagePageInput) => state.messagesPage(id, input),
      },
    };

    const page = await sessionMessagesPageState(runtime as any, {
      conversationId: "child",
      beforeId: null,
      limit: 10,
    });

    expect(state.messagePreloads).toEqual(["child", "child"]);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].message).toMatchObject({ role: "assistant", content: "first child message" });
  });
});

class FakeSessionState implements SessionStateStore {
  created = false;
  preloaded: string[] = [];
  messagePreloads: string[] = [];
  showMessageOnPreloadAttempt: number | null = null;
  private readonly summaries = new Map<string, BotSessionSummary>();
  private readonly messages = new Map<string, Array<{ id: number; message: BotMessage }>>();

  async preloadSession(conversationId: string): Promise<void> {
    this.preloaded.push(conversationId);
  }

  async preloadMessages(conversationId: string): Promise<void> {
    this.messagePreloads.push(conversationId);
    if (this.showMessageOnPreloadAttempt !== this.messagePreloads.length) return;
    this.messages.set(conversationId, [{
      id: 1,
      message: {
        role: "assistant",
        kind: "text",
        content: "first child message",
        createdAt: new Date("2026-04-30T00:00:00Z").toISOString(),
      },
    }]);
  }

  ensureSession(): void {
    this.created = true;
  }

  loadSession(): StoredSession | undefined {
    return undefined;
  }

  listSessions(): BotSessionSummary[] {
    return [];
  }

  findSessionsByName(): BotSessionSummary[] {
    return [];
  }

  getSummary(conversationId: string): BotSessionSummary | undefined {
    return this.summaries.get(conversationId);
  }

  renameSession(): void {}

  clearSession(): void {}

  deleteSession(): void {}

  deleteAllSessions(): void {}

  appendMessages(): void {}

  messagesPage(conversationId: string, input: MessagePageInput): MessagePage {
    const beforeId = input.beforeId ?? Number.POSITIVE_INFINITY;
    const available = (this.messages.get(conversationId) ?? []).filter((item) => item.id < beforeId);
    const items = available.slice(Math.max(0, available.length - input.limit));
    return {
      items,
      oldestId: items[0]?.id ?? null,
      newestId: items.at(-1)?.id ?? null,
      hasMoreBefore: available.length > items.length,
    };
  }

  childSessions(): BotSessionSummary[] {
    return [];
  }

  lastMessageId(): number | null {
    return null;
  }

  addSummary(conversationId: string, name: string, parentSessionId: string | null = null): void {
    const now = new Date("2026-04-30T00:00:00Z").toISOString();
    this.summaries.set(conversationId, {
      conversationId,
      name,
      nameSource: "generated",
      source: "test",
      model: null,
      systemPrompt: null,
      parentSessionId,
      parentMessageId: null,
      tokenTotals: { input: 0, output: 0, thought: 0, total: 0 },
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date("2026-05-01T00:00:00Z"),
    });
  }
}
