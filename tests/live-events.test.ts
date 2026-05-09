import { describe, expect, test } from "bun:test";
import { LiveEventHub, userMessageEvent } from "../src/web/live-events";

describe("web live events", () => {
  test("publishes user messages through the message event shape", () => {
    const event = userMessageEvent(
      "conversation",
      "hello from this tab",
      new Date("2026-04-30T00:00:00Z"),
    );

    expect(event).toMatchObject({
      type: "message",
      conversationId: "conversation",
      message: {
        role: "user",
        content: "hello from this tab",
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    });
  });

  test("delivers user message events to live subscribers", () => {
    const hub = new LiveEventHub();
    const received: unknown[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event));

    hub.publish(userMessageEvent("conversation", "live turn"));
    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "message",
      conversationId: "conversation",
      message: { role: "user", content: "live turn" },
    });
  });
});
