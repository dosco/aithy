import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { AgentDispatcher } from "../src/agent/dispatcher";

async function makeDispatcher(opts: {
  parallelAgents: number;
  ensureBotSandbox: () => Promise<void>;
  process: (data: any) => Promise<{ conversationId: string; text: string; createdAt: string }>;
  onCompleted?: (data: any, result: { conversationId: string; text: string; createdAt: string }) => void;
  onFailed?: (data: any, error: Error) => void;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-disp-"));
  const dispatcher = new AgentDispatcher({
    stateDbPath: path.join(root, "state.db"),
    parallelAgents: opts.parallelAgents,
    ensureBotSandbox: opts.ensureBotSandbox,
    process: opts.process,
    onCompleted: opts.onCompleted,
    onFailed: opts.onFailed,
  });
  return { dispatcher, root };
}

describe("AgentDispatcher", () => {
  test("waits for ensureBotSandbox to resolve before processing the job", async () => {
    let gateResolved = false;
    let processed = false;
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = () => {
        gateResolved = true;
        resolve();
      };
    });
    const completed: Array<{ conversationId: string; text: string; createdAt: string }> = [];

    const { dispatcher } = await makeDispatcher({
      parallelAgents: 1,
      ensureBotSandbox: () => gate,
      process: async (data) => {
        processed = true;
        // Sandbox readiness must precede process()
        expect(gateResolved).toBe(true);
        return {
          conversationId: data.conversationId,
          text: `processed:${data.text}`,
          createdAt: new Date().toISOString(),
        };
      },
      onCompleted: (_data, result) => completed.push(result),
    });

    const queued = await dispatcher.enqueueUserChat({
      conversationId: "c1",
      text: "hello",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });
    expect(queued.conversationId).toBe("c1");
    expect(queued.jobId).toMatch(/^agents\.user:/);

    // Give the worker a chance to pull the job; it should now be blocked on the gate.
    await new Promise((r) => setTimeout(r, 50));
    expect(processed).toBe(false);

    resolveGate();
    await waitFor(() => completed.length === 1);
    expect(completed[0]).toMatchObject({ conversationId: "c1", text: "processed:hello" });
    await dispatcher.close();
  });

  test("cancelByConversation cancels tracked jobs for that conversation only", async () => {
    let resolveProcess: (value: { conversationId: string; text: string; createdAt: string }) => void = () => {};
    const blocked = new Promise<{ conversationId: string; text: string; createdAt: string }>((resolve) => {
      resolveProcess = resolve;
    });
    const completed: string[] = [];

    const { dispatcher } = await makeDispatcher({
      parallelAgents: 2,
      ensureBotSandbox: async () => undefined,
      process: async (data) => {
        if (data.conversationId === "stop-me") return blocked;
        return {
          conversationId: data.conversationId,
          text: `ok:${data.text}`,
          createdAt: new Date().toISOString(),
        };
      },
      onCompleted: (_data, result) => completed.push(result.conversationId),
    });

    await dispatcher.enqueueUserChat({
      conversationId: "stop-me",
      text: "block",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });
    await dispatcher.enqueueUserChat({
      conversationId: "untouched",
      text: "fast",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });

    // Survivor should complete; the stopped one should remain cancellable.
    await waitFor(() => completed.includes("untouched"));

    const dropped = dispatcher.cancelByConversation("stop-me", "user pressed stop");
    expect(dropped).toBeGreaterThanOrEqual(1);

    // Even if the underlying process resolves later, cancellation removed tracking.
    resolveProcess({
      conversationId: "stop-me",
      text: "late",
      createdAt: new Date().toISOString(),
    });
    await dispatcher.close();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(predicate()).toBe(true);
}
