import { describe, expect, test } from "bun:test";
import { reduceStreamingDraft } from "../app/components/streaming-draft";

describe("streaming draft reducer", () => {
  test("appends ordered chunks and ignores stale sequences", () => {
    const first = reduceStreamingDraft(null, { turnKey: "run", seq: 1, text: "Hello" });
    const second = reduceStreamingDraft(first, { turnKey: "run", seq: 2, text: " world" });
    expect(second.text).toBe("Hello world");
    expect(reduceStreamingDraft(second, { turnKey: "run", seq: 1, text: " stale" })).toBe(second);
  });

  test("resets on version replacement or a new turn", () => {
    const current = { turnKey: "run", seq: 2, text: "bad draft" };
    expect(reduceStreamingDraft(current, { turnKey: "run", seq: 3, text: "fixed", reset: true }).text)
      .toBe("fixed");
    expect(reduceStreamingDraft(current, { turnKey: "repair", seq: 1, text: "new" }).text)
      .toBe("new");
  });
});
