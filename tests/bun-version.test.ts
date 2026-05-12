import { describe, expect, test } from "bun:test";
import { assertSupportedBunVersion, compareVersions } from "../src/runtime/bun-version";

describe("Bun version guard", () => {
  test("compares semantic versions", () => {
    expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
    expect(compareVersions("1.3.5", "1.3.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.9", "1.3.0")).toBeLessThan(0);
    expect(compareVersions("1.4.0+build", "1.3.0")).toBeGreaterThan(0);
  });

  test("rejects Bun versions below 1.3.0", () => {
    expect(() => assertSupportedBunVersion("1.2.9")).toThrow("requires Bun 1.3.0");
  });

  test("accepts Bun 1.3.0 and newer", () => {
    expect(() => assertSupportedBunVersion("1.3.0")).not.toThrow();
    expect(() => assertSupportedBunVersion("1.3.5")).not.toThrow();
    expect(() => assertSupportedBunVersion("1.3.14")).not.toThrow();
  });
});
