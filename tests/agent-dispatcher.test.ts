import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { Queue } from "bunqueue/client";
import { AgentDispatcher, UserChatCommandProducer, UserChatQueueProducer } from "../src/agent/dispatcher";
import { bunqueueDataPath } from "../src/queue/embedded";
import { RuntimeStore } from "../src/runtime/runtime-store";
import type { SetupStatusInput } from "../src/setup/status";

async function makeDispatcher(opts: {
  parallelAgents: number;
  ensureBotSandbox: () => Promise<void>;
  process: (data: any) => Promise<{ conversationId: string; text: string; createdAt: string }>;
  onStatus?: (status: SetupStatusInput) => void;
  onCompleted?: (data: any, result: { conversationId: string; text: string; createdAt: string }) => void;
  onFailed?: (data: any, error: Error) => void;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-disp-"));
  const dispatcher = new AgentDispatcher({
    stateDbPath: path.join(root, "state.db"),
    parallelAgents: opts.parallelAgents,
    ensureBotSandbox: opts.ensureBotSandbox,
    process: opts.process,
    onStatus: opts.onStatus,
    onCompleted: opts.onCompleted,
    onFailed: opts.onFailed,
  });
  return { dispatcher, root };
}

describe("AgentDispatcher", () => {
  test("producer enqueues without processing in the web process", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-producer-"));
    const stateDbPath = path.join(root, "state.db");
    const producer = new UserChatQueueProducer(stateDbPath);
    const queued = await producer.enqueueUserChat({
      conversationId: "producer-only",
      text: "hello",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });

    const queue = new Queue("aithy.agents.user", {
      embedded: true,
      dataPath: bunqueueDataPath(stateDbPath),
    });
    expect(await queue.getJobState(queued.jobId)).toBe("prioritized");
    queue.close();
    await producer.close();
  });

  test("command producer hands web chat requests to the agent worker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-command-producer-"));
    const store = new RuntimeStore(path.join(root, "state.db"));
    const producer = new UserChatCommandProducer(store);

    const queued = await producer.enqueueUserChat({
      conversationId: "commanded",
      text: "hello",
      createdAt: "2026-05-11T20:00:00.000Z",
      skillIds: ["skill-a"],
    });

    const commands = store.claimPendingCommands("agent-worker");
    expect(queued.conversationId).toBe("commanded");
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      id: queued.jobId,
      kind: "enqueue_user_chat",
      payload: {
        conversationId: "commanded",
        text: "hello",
        createdAt: "2026-05-11T20:00:00.000Z",
        skillIds: ["skill-a"],
      },
    });
    await producer.close();
    store.close();
  });

  test("returns from enqueue before the worker starts sandbox preparation", async () => {
    let ensureCalls = 0;
    const completed: string[] = [];

    const { dispatcher } = await makeDispatcher({
      parallelAgents: 1,
      ensureBotSandbox: async () => {
        ensureCalls += 1;
      },
      process: async (data) => ({
        conversationId: data.conversationId,
        text: `processed:${data.text}`,
        createdAt: new Date().toISOString(),
      }),
      onCompleted: (_data, result) => completed.push(result.conversationId),
    });

    await dispatcher.enqueueUserChat({
      conversationId: "c-responsive",
      text: "hello",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });

    expect(ensureCalls).toBe(0);
    await waitFor(() => completed.includes("c-responsive"));
    expect(ensureCalls).toBe(1);
    await dispatcher.close();
  });

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

  test("stays paused until dependency gate resumes it", async () => {
    let processed = false;
    const completed: string[] = [];
    const { dispatcher } = await makeDispatcher({
      parallelAgents: 1,
      ensureBotSandbox: async () => undefined,
      process: async (data) => {
        processed = true;
        return { conversationId: data.conversationId, text: "ok", createdAt: new Date().toISOString() };
      },
      onCompleted: (_data, result) => completed.push(result.conversationId),
    });

    dispatcher.pause("waiting for sandbox-worker");
    await dispatcher.enqueueUserChat({
      conversationId: "blocked",
      text: "hello",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(processed).toBe(false);
    expect(dispatcher.queueStatus()).toMatchObject({
      state: "blocked",
      blockedReason: "waiting for sandbox-worker",
      ownerRole: "agent-worker",
    });

    dispatcher.resume();
    await waitFor(() => completed.includes("blocked"));
    await dispatcher.close();
  });

  test("drops recovered local jobs that were not accepted by this worker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-recovered-job-"));
    const stateDbPath = path.join(root, "state.db");
    const producer = new UserChatQueueProducer(stateDbPath);
    await producer.enqueueUserChat({
      conversationId: "recovered",
      text: "old local job",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
      skillIds: [],
    });
    await producer.close();

    let processed = false;
    const completed: string[] = [];
    const failed: string[] = [];
    const dispatcher = new AgentDispatcher({
      stateDbPath,
      parallelAgents: 1,
      ensureBotSandbox: async () => undefined,
      process: async (data) => {
        processed = true;
        return { conversationId: data.conversationId, text: "unexpected", createdAt: new Date().toISOString() };
      },
      onCompleted: (_data, result) => completed.push(result.conversationId),
      onFailed: (_data, error) => failed.push(error.message),
    });

    await waitFor(() => completed.includes("recovered"));
    expect(processed).toBe(false);
    expect(failed).toEqual([]);
    await dispatcher.close();
  });

  test("emits only agent startup status for the chat run lifecycle", async () => {
    const statuses: SetupStatusInput[] = [];
    const completed: string[] = [];

    const { dispatcher } = await makeDispatcher({
      parallelAgents: 1,
      ensureBotSandbox: async () => undefined,
      onStatus: (status) => statuses.push(status),
      process: async (data) => ({
        conversationId: data.conversationId,
        text: `processed:${data.text}`,
        createdAt: new Date().toISOString(),
      }),
      onCompleted: (_data, result) => completed.push(result.conversationId),
    });

    await dispatcher.enqueueUserChat({
      conversationId: "c-status",
      text: "hello",
      createdAt: new Date().toISOString(),
      skillIds: [],
    });

    await waitFor(() => completed.includes("c-status"));

    expect(statuses[0]).toMatchObject({
      key: "agent",
      label: "Please wait agent starting",
      active: true,
    });
    expect(statuses.map((status) => status.label)).not.toContain("waiting for response");
    expect(statuses.map((status) => status.label)).not.toContain("response ready");
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
