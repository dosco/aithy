import { describe, expect, test } from "bun:test";
import {
  isSetupGuardExemptPath,
  sanitizeSetupRedirect,
} from "../app/lib/setup-redirect";

describe("setup redirect helpers", () => {
  test("preserves safe app paths", () => {
    expect(sanitizeSetupRedirect("/settings")).toBe("/settings");
    expect(sanitizeSetupRedirect("/chat/abc")).toBe("/chat/abc");
    expect(sanitizeSetupRedirect("/chat/abc?tab=tools#bottom")).toBe(
      "/chat/abc?tab=tools#bottom",
    );
  });

  test("normalizes unsafe or unusable redirect targets", () => {
    expect(sanitizeSetupRedirect("https://example.com/settings")).toBe("/chat/home");
    expect(sanitizeSetupRedirect("//example.com/settings")).toBe("/chat/home");
    expect(sanitizeSetupRedirect("/setup")).toBe("/chat/home");
    expect(sanitizeSetupRedirect("/setup?redirect=/settings")).toBe("/chat/home");
    expect(sanitizeSetupRedirect("/api/events")).toBe("/chat/home");
    expect(sanitizeSetupRedirect("")).toBe("/chat/home");
    expect(sanitizeSetupRedirect("/")).toBe("/chat/home");
  });

  test("exempts setup and event stream routes from the root guard", () => {
    expect(isSetupGuardExemptPath("/setup")).toBe(true);
    expect(isSetupGuardExemptPath("/setup/")).toBe(true);
    expect(isSetupGuardExemptPath("/api/events")).toBe(true);
    expect(isSetupGuardExemptPath("/api/other")).toBe(false);
    expect(isSetupGuardExemptPath("/chat")).toBe(false);
  });
});
