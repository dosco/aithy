import { describe, expect, test } from "bun:test";
import { assertSupportedBunVersion, compareVersions } from "../src/runtime/bun-version";

describe("Bun version guard", () => {
  test("compares semantic versions", () => {
    expect(compareVersions("1.4.0", "1.4.0")).toBe(0);
    expect(compareVersions("1.4.1", "1.4.0")).toBeGreaterThan(0);
    expect(compareVersions("1.3.14", "1.4.0")).toBeLessThan(0);
    expect(compareVersions("1.5.0+build", "1.4.0")).toBeGreaterThan(0);
  });

  test("rejects Bun versions below 1.4.0", () => {
    expect(() => assertSupportedBunVersion("1.3.14")).toThrow("requires Bun 1.4.0");
  });

  test("accepts Bun 1.4.0 and newer", () => {
    expect(() => assertSupportedBunVersion("1.4.0")).not.toThrow();
    expect(() => assertSupportedBunVersion("1.4.1")).not.toThrow();
  });
});
