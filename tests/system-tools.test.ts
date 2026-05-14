import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createAgentTools } from "../src/agent/tools";
import { loadConfig } from "../src/config/env";
import { RuntimeStore } from "../src/runtime/runtime-store";
import type { BotMessage } from "../src/session/types";

describe("system.bash tool", () => {
  test("waits for approval, persists permission, and runs on host", async () => {
    const ctx = await systemToolContext();
    const tool = systemBashTool(ctx);
    const resultPromise = tool.func({ command: "pwd", reason: "Need host cwd." });
    const request = await waitForPending(ctx.runtimeStore);

    expect(request).toMatchObject({
      toolName: "system.bash",
      command: "pwd",
      reason: "Need host cwd.",
      cwd: ctx.workspacePath,
    });
    ctx.runtimeStore.decidePermissionRequest(request.id, "allowed", "test allow");

    const result = await resultPromise;
    expect(result.stdout.trim()).toBe(ctx.workspacePath);
    expect(ctx.messages).toMatchObject([
      { role: "assistant", kind: "permission", requestId: request.id, status: "allowed" },
    ]);
    expect(ctx.audits).toMatchObject([{ allowed: true, capability: "system.bash" }]);
  });

  test("denied approval persists permission and rejects before execution", async () => {
    const ctx = await systemToolContext();
    const tool = systemBashTool(ctx);
    const resultPromise = tool.func({ command: "echo should-not-run", reason: "Need host shell." });
    const request = await waitForPending(ctx.runtimeStore);
    ctx.runtimeStore.decidePermissionRequest(request.id, "denied", "test deny");

    await expect(resultPromise).rejects.toThrow("system.bash denied by user");
    expect(ctx.messages).toMatchObject([
      { role: "assistant", kind: "permission", requestId: request.id, status: "denied" },
    ]);
    expect(ctx.audits).toMatchObject([{ allowed: false, capability: "system.bash" }]);
  });

  test("timed out approval persists expired permission and rejects before execution", async () => {
    const ctx = await systemToolContext();
    const tool = systemBashTool(ctx);
    const resultPromise = tool.func({ command: "echo should-not-run", reason: "Need host shell." });
    const request = await waitForPending(ctx.runtimeStore);
    ctx.runtimeStore.decidePermissionRequest(request.id, "timed_out", "test timeout");

    await expect(resultPromise).rejects.toThrow("system.bash timed out by user");
    expect(ctx.messages).toMatchObject([
      { role: "assistant", kind: "permission", requestId: request.id, status: "timed_out" },
    ]);
    expect(ctx.audits).toMatchObject([{ allowed: false, capability: "system.bash" }]);
  });

  test("blocks automatic repeat prompts for the same timed out command in one run", async () => {
    const ctx = await systemToolContext();
    const tool = systemBashTool(ctx);
    const resultPromise = tool.func({ command: "echo should-not-run", reason: "Need host shell." });
    const request = await waitForPending(ctx.runtimeStore);
    ctx.runtimeStore.decidePermissionRequest(request.id, "timed_out", "test timeout");
    await expect(resultPromise).rejects.toThrow("system.bash timed out by user");

    await expect(
      tool.func({ command: "echo should-not-run", reason: "Need host shell." }),
    ).rejects.toThrow("already timed out for this exact command");
    expect(ctx.messages).toHaveLength(1);
  });

  test("allows explicit retry in a fresh run context after timeout", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "aithy-system-tool-")));
    const runtimeStore = new RuntimeStore(path.join(root, "state.db"));
    const first = await systemToolContext({ root, runtimeStore });
    const firstTool = systemBashTool(first);
    const firstPromise = firstTool.func({ command: "echo retry", reason: "Need host shell." });
    const firstRequest = await waitForPending(runtimeStore);
    runtimeStore.decidePermissionRequest(firstRequest.id, "timed_out", "test timeout");
    await expect(firstPromise).rejects.toThrow("system.bash timed out by user");

    const second = await systemToolContext({ root, runtimeStore });
    const secondTool = systemBashTool(second);
    const secondPromise = secondTool.func({ command: "echo retry", reason: "Need host shell." });
    const secondRequest = await waitForPending(runtimeStore);
    expect(secondRequest.id).not.toBe(firstRequest.id);
    runtimeStore.decidePermissionRequest(secondRequest.id, "allowed", "test allow");

    await expect(secondPromise).resolves.toMatchObject({ exitCode: 0 });
    runtimeStore.close();
  });
});

async function systemToolContext(input: { root?: string; runtimeStore?: RuntimeStore } = {}) {
  const root = input.root ?? await realpath(await mkdtemp(path.join(tmpdir(), "aithy-system-tool-")));
  const runtimeStore = input.runtimeStore ?? new RuntimeStore(path.join(root, "state.db"));
  const messages: BotMessage[] = [];
  const eventSink: unknown[] = [];
  const audits: unknown[] = [];
  return {
    session: { conversationId: "c1" },
    workspacePath: root,
    runtimeStore,
    messages,
    eventSink,
    audits,
    sessions: { appendMessages: (_id: string, next: BotMessage[]) => messages.push(...next) },
    flushSessionState: async () => {},
    events: { emit: (event: unknown) => eventSink.push(event) },
    capabilities: { audit: (input: unknown) => audits.push(input) },
  } as any;
}

function systemBashTool(ctx: any) {
  return createAgentTools(ctx, loadConfig({ AITHY_SANDBOX_PROVIDER: "microsandbox" }))
    .find((tool: any) => tool.namespace === "system" && tool.name === "bash") as any;
}

async function waitForPending(runtimeStore: RuntimeStore) {
  for (let i = 0; i < 20; i += 1) {
    const [request] = runtimeStore.pendingPermissionRequests("c1");
    if (request) return request;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for pending permission request");
}
