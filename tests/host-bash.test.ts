import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { runHostBash } from "../src/system/host-bash";

describe("runHostBash", () => {
  test("runs commands with cwd and truncates output", async () => {
    const cwd = await realpath(await mkdtemp(path.join(tmpdir(), "aithy-host-bash-")));
    await Bun.write(path.join(cwd, "note.txt"), "hello");

    const result = await runHostBash({
      command: "pwd && cat note.txt",
      cwd,
      timeoutMs: 5_000,
      maxOutputChars: 12,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.startsWith(cwd.slice(0, 12))).toBe(true);
    expect(result.stdout).toContain("chars truncated");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  test("reports timeouts", async () => {
    const result = await runHostBash({
      command: "sleep 1",
      cwd: tmpdir(),
      timeoutMs: 10,
      maxOutputChars: 200,
    });

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("timed out");
    expect(result.timedOut).toBe(true);
  });
});
