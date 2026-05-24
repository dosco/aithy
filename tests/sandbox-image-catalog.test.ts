import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SANDBOX_IMAGE_SELECTION,
  resolveInternalSandboxImageRef,
  resolveSandboxImageConfig,
} from "../src/sandbox/image-catalog";

const packagedArm = { runtimeKind: "packaged" as const, arch: "arm64" as const, version: "1.2.3" };
const devAmd = { runtimeKind: "dev" as const, arch: "amd64" as const, version: "1.2.3" };

describe("sandbox image catalog", () => {
  test("resolves built-in images to arch-specific tags", () => {
    expect(resolveInternalSandboxImageRef("aithy-sandbox", packagedArm))
      .toBe("ghcr.io/dosco/aithy-sandbox:v1.2.3-arm64");
    expect(resolveInternalSandboxImageRef("aithy-sandbox-lite", devAmd))
      .toBe("ghcr.io/dosco/aithy-sandbox-lite:latest-amd64");
  });

  test("migrates legacy Aithy and python slim refs to the default internal image", () => {
    for (const image of [
      "ghcr.io/dosco/aithy-sandbox:latest",
      "ghcr.io/dosco/aithy-sandbox-lite:latest-arm64",
      "python:3.11-slim",
    ]) {
      const config = resolveSandboxImageConfig({ sandboxImage: image }, devAmd);
      expect(config.selection).toEqual(DEFAULT_SANDBOX_IMAGE_SELECTION);
      expect(config.image).toBe("ghcr.io/dosco/aithy-sandbox:latest-amd64");
    }
  });

  test("migrates arbitrary legacy refs to custom images without rewriting them", () => {
    const config = resolveSandboxImageConfig({ sandboxImage: "registry.example.test/tools:42" }, devAmd);
    expect(config.selection.kind).toBe("custom");
    expect(config.image).toBe("registry.example.test/tools:42");
    expect(config.customImages).toContainEqual(expect.objectContaining({
      image: "registry.example.test/tools:42",
    }));
  });
});
