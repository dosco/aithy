import { describe, expect, test } from "bun:test";
import { ensureRelativePath, safeJoin } from "../src/workspace/safe-path";

describe("safe workspace paths", () => {
  test("accepts simple relative paths", () => {
    expect(ensureRelativePath("inbox/file.txt")).toBe("inbox/file.txt");
  });

  test("rejects traversal and absolute paths", () => {
    expect(() => ensureRelativePath("../secret")).toThrow();
    expect(() => ensureRelativePath("/etc/passwd")).toThrow();
  });

  test("joins paths without escaping root", () => {
    const joined = safeJoin("/tmp/aithy-test", "out/result.txt");
    expect(joined).toBe("/tmp/aithy-test/out/result.txt");
  });
});
