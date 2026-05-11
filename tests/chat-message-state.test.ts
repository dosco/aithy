import { describe, expect, test } from "bun:test";
import { appendUnique, prependUnique } from "../app/components/chat-message-state";
import type { ChatMessageItem } from "../app/components/chat-timeline";

describe("chat message state", () => {
  test("dedupes an optimistic user message when the matching SSE event arrives", () => {
    const createdAt = "2026-05-10T12:00:00.000Z";
    const optimistic: ChatMessageItem = {
      id: "optimistic-user",
      message: { role: "user", content: "hello", createdAt },
    };
    const sse: ChatMessageItem = {
      id: "event-user",
      message: { role: "user", content: "hello", createdAt },
    };

    expect(appendUnique([optimistic], sse)).toEqual([optimistic]);
  });

  test("appends the same SSE message once in another tab", () => {
    const message: ChatMessageItem = {
      id: "event-assistant",
      message: {
        role: "assistant",
        kind: "text",
        content: "hi there",
        createdAt: "2026-05-10T12:00:01.000Z",
      },
    };

    const once = appendUnique([], message);
    const twice = appendUnique(once, { ...message, id: "event-assistant-again" });

    expect(twice).toEqual(once);
  });

  test("keeps persisted page items unique when a later SSE event repeats one", () => {
    const persisted: ChatMessageItem = {
      id: 42,
      message: {
        role: "assistant",
        kind: "text",
        content: "persisted reply",
        createdAt: "2026-05-10T12:00:02.000Z",
      },
    };
    const older: ChatMessageItem = {
      id: 41,
      message: { role: "user", content: "older", createdAt: "2026-05-10T11:59:59.000Z" },
    };

    expect(prependUnique([persisted], [older, persisted])).toEqual([older, persisted]);
    expect(appendUnique([persisted], { ...persisted, id: "event-repeat" })).toEqual([persisted]);
  });
});
