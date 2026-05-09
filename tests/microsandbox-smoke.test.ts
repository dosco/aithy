import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { MicrosandboxProvider } from "../src/sandbox/microsandbox-provider";

describe("Microsandbox smoke", () => {
  test("runs python when explicitly enabled", async () => {
    if (process.env.AITHY_MICROSANDBOX_SMOKE !== "1") {
      expect(true).toBe(true);
      return;
    }

    const provider = new MicrosandboxProvider({
      image: "python:3.11-slim",
      cpus: 1,
      memoryMb: 512,
      network: "none"
    });
    const workspacePath = await mkdtemp(path.join(tmpdir(), "aithy-smoke-"));
    const session = await provider.createSession("smoke", workspacePath, []);
    try {
      const result = await provider.bash(session.id, { command: "python -c \"print('ok')\"" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ok");
    } finally {
      await provider.destroy(session.id);
    }
  });
});
