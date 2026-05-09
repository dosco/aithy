import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { DisabledSandboxProvider } from "../src/sandbox/disabled-provider";
import type { SessionMount } from "../src/sandbox/provider";

describe("DisabledSandboxProvider", () => {
  test("runs real Bun Shell commands in the workspace", async () => {
    const { provider, session, workspace } = await makeSession();

    const result = await provider.bash(session.id, { command: "pwd && echo ok" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(workspace);
    expect(result.stdout).toContain("ok");
    expect(result.stderr).toBe("");
  });

  test("supports workspace cwd forms and rejects host paths", async () => {
    const { provider, session, workspace } = await makeSession();
    await mkdir(path.join(workspace, "sub"), { recursive: true });

    const absolute = await provider.bash(session.id, { command: "pwd", cwd: "/workspace/sub" });
    const relative = await provider.bash(session.id, { command: "pwd", cwd: "sub" });

    expect(absolute.stdout.trim()).toBe(path.join(workspace, "sub"));
    expect(relative.stdout.trim()).toBe(path.join(workspace, "sub"));
    await expect(
      provider.bash(session.id, { command: "pwd", cwd: "/tmp" }),
    ).rejects.toThrow("Disabled sandbox path must stay under /workspace");
  });

  test("returns non-zero exit codes without throwing", async () => {
    const { provider, session } = await makeSession();

    const result = await provider.bash(session.id, {
      command: "bun -e \"process.stderr.write('nope'); process.exit(7)\"",
    });

    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain("nope");
    expect(result.timedOut).toBe(false);
  });

  test("kills long-running commands on timeout", async () => {
    const { provider, session } = await makeSession();

    const result = await provider.bash(session.id, {
      command: "sleep 2",
      timeoutMs: 50,
    });

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("Command timed out");
    expect(result.timedOut).toBe(true);
  });

  test("reads, writes, and edits files under the workspace", async () => {
    const { provider, session, workspace } = await makeSession();

    const written = await provider.write(session.id, "/workspace/out/result.txt", "hello world");
    expect(written).toEqual({ path: "/workspace/out/result.txt", sizeBytes: 11 });
    expect(await provider.read(session.id, "out/result.txt")).toBe("hello world");

    const edited = await provider.edit(session.id, "/workspace/out/result.txt", "world", "host");
    expect(edited).toEqual({ path: "/workspace/out/result.txt", sizeBytes: 10 });
    expect(await Bun.file(path.join(workspace, "out/result.txt")).text()).toBe("hello host");
    await expect(
      provider.read(session.id, "/tmp/result.txt"),
    ).rejects.toThrow("Disabled sandbox path must stay under /workspace");
  });

  test("ignores mounts when creating or recreating sessions", async () => {
    const { provider, session, workspace } = await makeSession([
      { hostPath: "/tmp/secret", mountName: "secret-1234" },
    ]);

    await provider.recreate(session.id, workspace, [
      { hostPath: "/tmp/other", mountName: "other-1234" },
    ]);
    const result = await provider.bash(session.id, { command: "ls -A mounts" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});

async function makeSession(mounts: SessionMount[] = []) {
  const workspace = await mkdtemp(path.join(tmpdir(), "aithy-disabled-"));
  const provider = new DisabledSandboxProvider();
  const session = await provider.createSession("conversation", workspace, mounts);
  return { provider, session, workspace };
}
