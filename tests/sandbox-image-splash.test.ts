import { describe, expect, test } from "bun:test";
import {
  isSandboxImageStatus,
  visibleSandboxImageStatus,
} from "../app/components/sandbox-image-splash-model";
import type { RuntimeSetupStatusDto } from "../app/server/runtime-console.dto";

describe("sandbox image splash status selection", () => {
  test("shows image pull and filesystem preparation statuses", () => {
    expect(isSandboxImageStatus(status("downloading sandbox image ghcr.io/dosco/aithy-sandbox:latest", {
      progress: 0.5,
      loadedBytes: 50,
      totalBytes: 100,
    }))).toBe(true);
    expect(isSandboxImageStatus(status("preparing sandbox filesystem", { progress: 0.8 }))).toBe(true);
  });

  test("does not show for ordinary sandbox lifecycle statuses", () => {
    expect(isSandboxImageStatus(status("starting sandbox"))).toBe(false);
    expect(isSandboxImageStatus(status("starting sandbox image ghcr.io/dosco/aithy-sandbox:latest"))).toBe(false);
    expect(isSandboxImageStatus(status("refreshing sandbox mounts"))).toBe(false);
    expect(isSandboxImageStatus(status("sandbox image ready", { active: false, progress: 1 }))).toBe(false);
  });

  test("keeps a sandbox failure visible", () => {
    expect(isSandboxImageStatus(status("sandbox failed: pull denied", {
      active: false,
      tone: "danger",
    }))).toBe(true);
  });

  test("selects the newest visible sandbox image status from active statuses", () => {
    const selected = visibleSandboxImageStatus([
      status("starting sandbox"),
      status("downloading sandbox image ghcr.io/dosco/aithy-sandbox:latest", { progress: 0.25 }),
    ]);

    expect(selected?.label).toContain("downloading sandbox image");
  });
});

function status(
  label: string,
  overrides: Partial<RuntimeSetupStatusDto> = {},
): RuntimeSetupStatusDto {
  return {
    type: "setup-status",
    id: label,
    createdAt: "2026-05-23T00:00:00.000Z",
    key: "sandbox",
    label,
    active: true,
    tone: "neutral",
    ...overrides,
  };
}
