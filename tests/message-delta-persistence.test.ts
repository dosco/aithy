import { describe, expect, test } from "bun:test";
import { shouldPersistRuntimeEvent } from "../src/runtime/services/queue/runtime";

describe("message delta persistence", () => {
  test("broadcast-only deltas are excluded from runtime event history", () => {
    expect(shouldPersistRuntimeEvent({
      type: "message-delta",
      id: "delta",
      conversationId: "session",
      createdAt: new Date().toISOString(),
      turnKey: "run",
      seq: 1,
      text: "hello",
    })).toBe(false);
    expect(shouldPersistRuntimeEvent({
      type: "activity",
      id: "activity",
      conversationId: "session",
      createdAt: new Date().toISOString(),
      label: "working",
    })).toBe(true);
  });
});
