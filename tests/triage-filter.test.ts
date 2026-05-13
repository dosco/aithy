import { describe, expect, test } from "bun:test";
import type { BotMessage } from "../src/session/types";
import { isTrivialUserTurn, shouldQueueAutoMemory } from "../src/memory/auto-gate";

describe("isTrivialUserTurn", () => {
  test.each([
    ["yes", true],
    ["YES", true],
    ["yes!", true],
    ["thanks!!", true],
    ["thx", true],
    ["ok", true],
    ["ok 👍", true],
    ["👍", true],
    ["✅✅", true],
    ["", true],
    ["   ", true],
  ])("treats %p as trivial", (input, expected) => {
    expect(isTrivialUserTurn(input)).toBe(expected);
  });

  test.each([
    "coffee",
    "tabs",
    "ripgrep",
    "I prefer dark mode",
    "use bun",
    "the one in ~/src/foo",
    "🎯 ship it",
  ])("keeps %p as content-bearing", (input) => {
    expect(isTrivialUserTurn(input)).toBe(false);
  });
});

describe("shouldQueueAutoMemory", () => {
  test.each([
    "i like coffee, really like it",
    "I might try cold brew someday",
    "I prefer concise answers",
    "I usually use Bun for JS projects",
    "my main repo is ~/src/foo",
  ])("queues durable memory candidate %p", (userText) => {
    expect(shouldQueueAutoMemory({ userText })).toBe(true);
  });

  test.each([
    "I like this answer",
    "tell me a joke",
    "thanks",
    "👍",
    "I might try that",
  ])("skips low-value memory candidate %p", (userText) => {
    expect(shouldQueueAutoMemory({ userText })).toBe(false);
  });

  test("queues short answers only when the prior assistant turn asks for a preference", () => {
    expect(shouldQueueAutoMemory({ userText: "coffee" })).toBe(false);
    expect(shouldQueueAutoMemory({
      userText: "coffee",
      priorMessages: [assistantText("What's your go-to cup?")],
    })).toBe(true);
    expect(shouldQueueAutoMemory({
      userText: "coffee",
      priorMessages: [assistantText("Want to hear a joke?")],
    })).toBe(false);
  });
});

function assistantText(content: string): BotMessage {
  return {
    role: "assistant",
    kind: "text",
    content,
    createdAt: "2026-05-12T00:00:00.000Z",
  };
}
