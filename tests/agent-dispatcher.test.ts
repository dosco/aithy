import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { AgentDispatcher } from "../src/agent/dispatcher";

async function makeDispatcher(opts: {
  parallelAgents: number;
  ensureBotSandbox: () => Promise<void>;
  process: (data: any) => Promise<{ conversationId: string; text: string }>;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-disp-"));
  const dispatcher = new AgentDispatcher({
    stateDbPath: path.join(root, "state.db"),
    parallelAgents: opts.parallelAgents,
    ensureBotSandbox: opts.ensureBotSandbox,
    process: opts.process,
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

    const { dispatcher } = await makeDispatcher({
      parallelAgents: 1,
      ensureBotSandbox: () => gate,
      process: async (data) => {
        processed = true;
        // Sandbox readiness must precede process()
        expect(gateResolved).toBe(true);
        return { conversationId: data.conversationId, text: `processed:${data.text}` };
      },
    });

    const inFlight = dispatcher.enqueueUserChat({
      conversationId: "c1",
      text: "hello",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });

    // Give the worker a chance to pull the job; it should now be blocked on the gate.
    await new Promise((r) => setTimeout(r, 50));
    expect(processed).toBe(false);

    resolveGate();
    const result = await inFlight;
    expect(result).toEqual({ conversationId: "c1", text: "processed:hello" });
    await dispatcher.close();
  });

  test("cancelByConversation rejects in-flight jobs for that conversation only", async () => {
    let resolveProcess: (value: { conversationId: string; text: string }) => void = () => {};
    const blocked = new Promise<{ conversationId: string; text: string }>((resolve) => {
      resolveProcess = resolve;
    });

    const { dispatcher } = await makeDispatcher({
      parallelAgents: 2,
      ensureBotSandbox: async () => undefined,
      process: async (data) => {
        if (data.conversationId === "stop-me") return blocked;
        return { conversationId: data.conversationId, text: `ok:${data.text}` };
      },
    });

    const stopMe = dispatcher.enqueueUserChat({
      conversationId: "stop-me",
      text: "block",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });
    const survivor = dispatcher.enqueueUserChat({
      conversationId: "untouched",
      text: "fast",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });

    // Survivor should complete; the stopped one should reject after cancel.
    expect(await survivor).toEqual({ conversationId: "untouched", text: "ok:fast" });

    const dropped = dispatcher.cancelByConversation("stop-me", "user pressed stop");
    expect(dropped).toBeGreaterThanOrEqual(1);
    await expect(stopMe).rejects.toThrow();

    // Even if the underlying process resolves later, the dispatcher promise is already rejected.
    resolveProcess({ conversationId: "stop-me", text: "late" });
    await dispatcher.close();
  });
});
