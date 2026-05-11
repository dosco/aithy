import { describe, expect, test } from "bun:test";
import { dedupeExtractedItems } from "../src/conversation-analysis/dedupe";

describe("dedupeExtractedItems", () => {
  test("uses caller search results to return only new extraction candidates", async () => {
    const searches: string[] = [];

    const result = await dedupeExtractedItems(["known", "fresh"], {
      search: ({ item }) => {
        searches.push(item);
        return item === "known" ? ["existing-known"] : [];
      },
      isDuplicate: ({ matches }) => matches.length > 0,
    });

    expect(result.newItems).toEqual(["fresh"]);
    expect(result.duplicates).toEqual([
      { item: "known", index: 0, matches: ["existing-known"] },
    ]);
    expect(searches).toEqual(["known", "fresh"]);
  });

  test("can suppress duplicate candidates from the same extraction batch", async () => {
    const searches: string[] = [];

    const result = await dedupeExtractedItems(["alpha", "alpha", "beta"], {
      key: (item) => item,
      search: ({ item }) => {
        searches.push(item);
        return [];
      },
      isDuplicate: () => false,
    });

    expect(result.newItems).toEqual(["alpha", "beta"]);
    expect(result.duplicates).toEqual([{ item: "alpha", index: 1, matches: [] }]);
    expect(searches).toEqual(["alpha", "beta"]);
  });
});
