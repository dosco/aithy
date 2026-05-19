import { describe, expect, test } from "bun:test";
import { buildTimeline, type ChatMessageItem } from "../app/components/chat-timeline";
import type { SerializableBotMessage } from "../src/web/live-events";

describe("buildTimeline day dividers", () => {
  test("adds one divider for each day with messages", () => {
    const timeline = buildTestTimeline({
      messages: [
        item("u1", user("hello", "2026-05-01T12:00:00.000Z")),
        item("a1", assistant("hi", "2026-05-01T12:00:01.000Z")),
        item("u2", user("next day", "2026-05-02T12:00:00.000Z")),
      ],
    });

    expect(timeline.filter((entry) => entry.kind === "day-divider").map((entry) => entry.key)).toEqual([
      "day-2026-05-01",
      "day-2026-05-02",
    ]);
  });

  test("does not add a divider for an empty timeline", () => {
    expect(buildTestTimeline()).toEqual([]);
  });

  test("does not add a divider for activity-only days", () => {
    const timeline = buildTestTimeline({
      details: true,
      activities: [{
        type: "activity",
        id: "activity-1",
        conversationId: "session",
        createdAt: "2026-05-01T12:00:00.000Z",
        label: "Working",
      }],
    });

    expect(timeline.map((entry) => entry.kind)).toEqual(["activity"]);
  });

  test("keeps dividers in chronological order with mixed entries", () => {
    const timeline = buildTestTimeline({
      details: true,
      messages: [
        item("u1", user("hello", "2026-05-01T12:00:00.000Z")),
        item("a1", assistant("done", "2026-05-02T12:00:00.000Z")),
      ],
      activities: [{
        type: "activity",
        id: "activity-1",
        conversationId: "session",
        createdAt: "2026-05-01T11:00:00.000Z",
        label: "Starting",
      }],
    });

    expect(timeline.map((entry) => entry.kind)).toEqual([
      "day-divider",
      "activity",
      "user",
      "day-divider",
      "assistant",
    ]);
  });
});

function buildTestTimeline(input: {
  messages?: ChatMessageItem[];
  activities?: Array<{
    type: "activity";
    id: string;
    conversationId: string;
    createdAt: string;
    label: string;
  }>;
  details?: boolean;
} = {}) {
  return buildTimeline({
    messages: input.messages ?? [],
    subSessions: [],
    activities: input.activities ?? [],
    permissionRequests: [],
    retryableTasks: [],
    retryingTaskIds: new Set(),
    retryDisabled: false,
    details: input.details ?? false,
    sending: false,
  });
}

function item(id: string, message: SerializableBotMessage): ChatMessageItem {
  return { id, message };
}

function user(content: string, createdAt: string): SerializableBotMessage {
  return { role: "user", content, createdAt };
}

function assistant(content: string, createdAt: string): SerializableBotMessage {
  return { role: "assistant", kind: "text", content, createdAt };
}
