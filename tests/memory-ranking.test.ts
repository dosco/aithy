import { describe, expect, test } from "bun:test";
import { score } from "../src/memory/ranking";

describe("memory ranking score", () => {
  const now = Date.parse("2026-05-07T00:00:00Z");
  const recent = "2026-05-06T00:00:00Z";
  const old = "2025-05-07T00:00:00Z";

  test("better bm25 (more negative) yields higher score", () => {
    const better = score({ bm25: -10, importance: 0.5, updatedAt: recent, now });
    const worse = score({ bm25: -1, importance: 0.5, updatedAt: recent, now });
    expect(better).toBeGreaterThan(worse);
  });

  test("higher importance yields higher score for same bm25", () => {
    const high = score({ bm25: -5, importance: 0.9, updatedAt: recent, now });
    const low = score({ bm25: -5, importance: 0.1, updatedAt: recent, now });
    expect(high).toBeGreaterThan(low);
  });

  test("more recent yields higher score for same bm25 + importance", () => {
    const fresh = score({ bm25: -5, importance: 0.5, updatedAt: recent, now });
    const stale = score({ bm25: -5, importance: 0.5, updatedAt: old, now });
    expect(fresh).toBeGreaterThan(stale);
  });

  test("clamps importance outside 0..1", () => {
    const huge = score({ bm25: -5, importance: 10, updatedAt: recent, now });
    const one = score({ bm25: -5, importance: 1, updatedAt: recent, now });
    expect(huge).toBe(one);
  });
});
