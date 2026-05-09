import { describe, expect, test } from "bun:test";
import { isTrivialUserTurn } from "../src/agent/triage-filter";

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
