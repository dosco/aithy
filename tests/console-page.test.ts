import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { SandboxStatusPanel } from "../app/components/console/console-sandbox-status";
import type { RuntimeServiceDto } from "../app/server/runtime-console.dto";

describe("SandboxStatusPanel", () => {
  test("surfaces the running sandbox image in the status panel", () => {
    const html = renderToStaticMarkup(React.createElement(SandboxStatusPanel, {
      service: sandboxService(),
    }));

    expect(html).toContain("sandbox vm");
    expect(html).toContain("selected:");
    expect(html).toContain("aithy-sandbox-lite");
    expect(html).toContain("Aithy Sandbox Lite");
    expect(html).toContain("ghcr.io/dosco/aithy-sandbox-lite:latest-arm64");
    expect(html).toContain("microsandbox / none");
  });
});

function sandboxService(): RuntimeServiceDto {
  return {
    role: "sandbox-worker",
    state: "ready",
    pid: 123,
    lastSeenAt: new Date().toISOString(),
    detail: {
      provider: "microsandbox",
      selection: "aithy-sandbox-lite",
      label: "Aithy Sandbox Lite",
      image: "ghcr.io/dosco/aithy-sandbox-lite:latest-arm64",
      network: "none",
      cpus: 1,
      memoryMb: 512,
    },
  };
}
