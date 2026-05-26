import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import {
  missingCapabilitySummary,
  runSandboxDoctor,
  type SandboxCapabilityCheck,
} from "../src/sandbox/health";
import type { SandboxProvider } from "../src/sandbox/provider";

describe("sandbox doctor", () => {
  test("marks the sandbox ready when all capability groups pass", async () => {
    const report = await runSandboxDoctor({
      provider: providerFor(checks({ missingDocument: false, missingMedia: false })),
      sessionId: "s1",
      config: loadConfig(),
    });

    expect(report.status).toBe("ready");
    expect(report.sessionId).toBe("s1");
    expect(report.capabilities.every((check) => check.ok)).toBe(true);
  });

  test("reports missing tools by capability group", async () => {
    const report = await runSandboxDoctor({
      provider: providerFor(checks({ missingDocument: true, missingMedia: true })),
      sessionId: "s1",
      config: loadConfig(),
    });

    expect(report.status).toBe("degraded");
    expect(missingCapabilitySummary(report, ["document", "media"])).toEqual([
      "document: missing command docling",
      "media: missing command ffmpeg",
    ]);
  });
});

function providerFor(output: SandboxCapabilityCheck[]): SandboxProvider {
  return {
    async createSession() { return { id: "s1", name: "s1" }; },
    async recreate() { return { id: "s1", name: "s1" }; },
    async bash() { return { exitCode: 0, stdout: JSON.stringify(output), stderr: "", timedOut: false }; },
    async read() { return ""; },
    async write() { return { path: "", sizeBytes: 0 }; },
    async edit() { return { path: "", sizeBytes: 0 }; },
    async park() {},
    async resume() {},
    async destroy() {},
  };
}

function checks(input: { missingDocument: boolean; missingMedia: boolean }): SandboxCapabilityCheck[] {
  return [
    check("core", []),
    check("python", []),
    check("document", input.missingDocument ? ["docling"] : []),
    check("media", input.missingMedia ? ["ffmpeg"] : []),
  ];
}

function check(group: SandboxCapabilityCheck["group"], missingCommands: string[]): SandboxCapabilityCheck {
  return {
    group,
    ok: missingCommands.length === 0,
    commands: missingCommands.length ? missingCommands : ["ok"],
    missingCommands,
    pythonImports: [],
    missingPythonImports: [],
  };
}
