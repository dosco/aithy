import { describe, expect, test } from "bun:test";
import { createAgentTools } from "../src/agent/tools";
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
    const names = createAgentTools({} as any, "disabled")
      .map((tool: any) => `${tool.namespace}.${tool.name}`);

    expect(names).toContain("sandbox.bash");
    expect(names).toContain("sandbox.edit");
    expect(names).not.toContain("sandbox.mount");
    expect(names).not.toContain("sandbox.getPath");
  });

  test("includes mount tools for microsandbox", () => {
    const names = createAgentTools({} as any, "microsandbox")
      .map((tool: any) => `${tool.namespace}.${tool.name}`);

    expect(names).toContain("sandbox.mount");
    expect(names).toContain("sandbox.getPath");
  });
});
