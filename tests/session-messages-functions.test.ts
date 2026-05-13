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
});

class FakeSessionState implements SessionStateStore {
  created = false;
  preloaded: string[] = [];

  async preloadSession(conversationId: string): Promise<void> {
    this.preloaded.push(conversationId);
  }

  async preloadMessages(): Promise<void> {}

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

  getSummary(_conversationId: string): BotSessionSummary | undefined {
    return undefined;
  }

  renameSession(): void {}

  clearSession(): void {}

  deleteSession(): void {}

  deleteAllSessions(): void {}

  appendMessages(): void {}

  messagesPage(_conversationId: string, _input: MessagePageInput): MessagePage {
    return {
      items: [],
      oldestId: null,
      newestId: null,
      hasMoreBefore: false,
    };
  }

  childSessions(): BotSessionSummary[] {
    return [];
  }

  lastMessageId(): number | null {
    return null;
  }
}
