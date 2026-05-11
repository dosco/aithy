import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAgentTools } from "../src/agent/tools";
import { resolveSandboxPathForHostPath } from "../src/agent/tools/mount-tools";
import { loadConfig } from "../src/config/env";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";

describe("sandbox provider file operations", () => {
  test("writes, reads, edits, and records bash calls", async () => {
    const provider = new MockSandboxProvider();
    const session = await provider.createSession("tools", "/tmp/aithy-mock", []);

    await provider.write(session.id, "/workspace/out/result.txt", "hello world");
    expect(await provider.read(session.id, "/workspace/out/result.txt")).toBe("hello world");

    await provider.edit(session.id, "/workspace/out/result.txt", "world", "sandbox");
    expect(await provider.read(session.id, "/workspace/out/result.txt")).toBe("hello sandbox");

    const bash = await provider.bash(session.id, { command: "wc -c out/result.txt" });
    expect(bash.stdout).toContain("wc -c out/result.txt");
    expect(provider.bashCalls).toHaveLength(1);
  });

  test("recreate replaces the mount list for a session", async () => {
    const provider = new MockSandboxProvider();
    const session = await provider.createSession("mounts", "/tmp/aithy-mock", []);

    expect(provider.mounts.get(session.id)).toEqual([]);

    await provider.recreate(session.id, "/tmp/aithy-mock", [
      { hostPath: "/tmp/example.txt", mountName: "example.txt-abcd1234" },
    ]);
    expect(provider.mounts.get(session.id)).toEqual([
      { hostPath: "/tmp/example.txt", mountName: "example.txt-abcd1234" },
    ]);
    expect(provider.recreates).toHaveLength(1);
  });
});

describe("agent sandbox tools", () => {
  test("omits mount tools when sandboxing is disabled", () => {
    const names = createAgentTools(
      {} as any,
      loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
    )
      .map((tool: any) => `${tool.namespace}.${tool.name}`);

    expect(names).toContain("sandbox.bash");
    expect(names).toContain("sandbox.edit");
    expect(names).toContain("web.scrape");
    expect(names).not.toContain("sandbox.mount");
    expect(names).not.toContain("sandbox.getPath");
  });

  test("includes mount tools for microsandbox", () => {
    const names = createAgentTools(
      {} as any,
      loadConfig({ AITHY_SANDBOX_PROVIDER: "microsandbox" }),
    )
      .map((tool: any) => `${tool.namespace}.${tool.name}`);

    expect(names).toContain("sandbox.mount");
    expect(names).toContain("sandbox.getPath");
    expect(names).toContain("web.scrape");
  });

  test("getPath resolves files under mounted folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aithy-getpath-mount-"));
    const child = path.join(root, "nested", "note.txt");
    await mkdir(path.dirname(child), { recursive: true });
    await Bun.write(child, "hello");
    const resolvedRoot = await realpath(root);

    await expect(resolveSandboxPathForHostPath({
      hostPath: child,
      mounts: [{ hostPath: resolvedRoot, mountName: "project-12345678" }],
      workspacePath: "/unused",
    })).resolves.toBe("/mounts/project-12345678/nested/note.txt");
  });

  test("getPath resolves hashed workspace file copies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aithy-getpath-file-"));
    const workspace = path.join(root, "workspace");
    const source = path.join(root, "source", "data.txt");
    await mkdir(workspace, { recursive: true });
    await mkdir(path.dirname(source), { recursive: true });
    await Bun.write(source, "source");
    const resolvedSource = await realpath(source);
    const hash = createHash("sha256").update(resolvedSource).digest("hex").slice(0, 8);
    const copiedName = `data-${hash}.txt`;
    await Bun.write(path.join(workspace, copiedName), "copied");

    await expect(resolveSandboxPathForHostPath({
      hostPath: source,
      mounts: [],
      workspacePath: workspace,
    })).resolves.toBe(`/workspace/${copiedName}`);
  });

  test("getPath resolves direct workspace file copies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aithy-getpath-direct-file-"));
    const workspace = path.join(root, "workspace");
    const source = path.join(root, "source", "plain.txt");
    await mkdir(workspace, { recursive: true });
    await mkdir(path.dirname(source), { recursive: true });
    await Bun.write(source, "source");
    await Bun.write(path.join(workspace, "plain.txt"), "copied");

    await expect(resolveSandboxPathForHostPath({
      hostPath: source,
      mounts: [],
      workspacePath: workspace,
    })).resolves.toBe("/workspace/plain.txt");
  });
});
