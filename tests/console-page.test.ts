import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { SandboxStatusPanel } from "../app/components/console/console-sandbox-status";
import { ServiceStatus, serviceStatusSummary } from "../app/components/console/console-service-status";
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

  test("summarizes degraded local inference retry status", () => {
    const service = degradedLocalInferenceService();
    const html = renderToStaticMarkup(React.createElement(ServiceStatus, { service }));

    expect(serviceStatusSummary(service)).toBe("llama-server exited with code 0; retrying in 4s");
    expect(html).toContain("llama-server exited with code 0; retrying in 4s");
    expect(html).not.toContain("restartAttempt");
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

function degradedLocalInferenceService(): RuntimeServiceDto {
  return {
    role: "local-inference-worker",
    state: "degraded",
    pid: 123,
    lastSeenAt: new Date().toISOString(),
    detail: {
      error: "llama-server exited with code 0",
      restartAttempt: 3,
      restartInMs: 4_000,
      lastRouterExitCode: 0,
      lastRouterExitAt: "2026-05-24T01:59:11.601Z",
    },
  };
}
