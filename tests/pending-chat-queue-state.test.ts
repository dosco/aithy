import { describe, expect, test } from "bun:test";
import {
  addPendingMessage,
  dequeuePendingMessage,
  loadPendingChatQueue,
  PENDING_CHAT_QUEUE_STORAGE_KEY,
  pendingMessagesForSession,
  removePendingMessage,
  savePendingChatQueue,
  type PendingChatMessage,
  type PendingChatStorage,
} from "../app/components/pending-chat-queue-state";

describe("pending chat queue state", () => {
  test("stores pending messages by session", () => {
    const first = pendingMessage("session-a", "first");
    const second = pendingMessage("session-b", "second");
    const store = addPendingMessage(addPendingMessage({}, first), second);

    expect(pendingMessagesForSession(store, "session-a")).toEqual([first]);
    expect(pendingMessagesForSession(store, "session-b")).toEqual([second]);
    expect(pendingMessagesForSession(store, "missing")).toEqual([]);
  });

  test("preserves order and selected skill snapshots", () => {
    const first = pendingMessage("session-a", "first", [{ id: "s1", name: "Skill One" }]);
    const second = pendingMessage("session-a", "second", [{ id: "s2", name: "Skill Two" }]);
    const store = addPendingMessage(addPendingMessage({}, first), second);

    expect(pendingMessagesForSession(store, "session-a").map((message) => message.text)).toEqual([
      "first",
      "second",
    ]);
    expect(pendingMessagesForSession(store, "session-a")[0].skills).toEqual([
      { id: "s1", name: "Skill One" },
    ]);
  });

  test("remove and storage save update persisted state", () => {
    const storage = new MemoryStorage();
    const first = pendingMessage("session-a", "first");
    const second = pendingMessage("session-a", "second");
    const store = addPendingMessage(addPendingMessage({}, first), second);

    savePendingChatQueue(storage, removePendingMessage(store, "session-a", first.id));

    expect(loadPendingChatQueue(storage)).toEqual({ "session-a": [second] });
  });

  test("dequeue returns only the oldest pending message", () => {
    const first = pendingMessage("session-a", "first");
    const second = pendingMessage("session-a", "second");
    const store = addPendingMessage(addPendingMessage({}, first), second);

    const result = dequeuePendingMessage(store, "session-a");

    expect(result.message).toEqual(first);
    expect(pendingMessagesForSession(result.store, "session-a")).toEqual([second]);
  });

  test("saving an empty queue clears local storage", () => {
    const storage = new MemoryStorage();
    savePendingChatQueue(storage, { "session-a": [pendingMessage("session-a", "first")] });
    savePendingChatQueue(storage, {});

    expect(storage.getItem(PENDING_CHAT_QUEUE_STORAGE_KEY)).toBeNull();
  });
});

function pendingMessage(
  conversationId: string,
  text: string,
  skills: PendingChatMessage["skills"] = [],
): PendingChatMessage {
  return {
    id: `${conversationId}-${text}`,
    conversationId,
    text,
    queuedAt: "2026-05-10T12:00:00.000Z",
    skills,
  };
}

class MemoryStorage implements PendingChatStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
