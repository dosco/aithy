import { describe, expect, test } from "bun:test";
import { assertSupportedBunVersion, compareVersions } from "../src/runtime/bun-version";

describe("Bun version guard", () => {
  test("compares semantic versions", () => {
    expect(compareVersions("1.3.14", "1.3.14")).toBe(0);
    expect(compareVersions("1.3.15", "1.3.14")).toBeGreaterThan(0);
    expect(compareVersions("1.3.13", "1.3.14")).toBeLessThan(0);
    expect(compareVersions("1.4.0+build", "1.3.14")).toBeGreaterThan(0);
  });

  test("rejects Bun versions below 1.3.14", () => {
    expect(() => assertSupportedBunVersion("1.3.13")).toThrow("requires Bun 1.3.14");
  });

  test("accepts Bun 1.3.14 and newer", () => {
    expect(() => assertSupportedBunVersion("1.3.14")).not.toThrow();
    expect(() => assertSupportedBunVersion("1.3.15")).not.toThrow();
  });
});
