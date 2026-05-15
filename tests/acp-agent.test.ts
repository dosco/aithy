import { PassThrough, Readable, Writable } from "node:stream";
import { describe, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import {
  AithyAcpAgent,
  type AithyAcpBridge,
  type AithyAcpRunPromptInput,
} from "../src/acp/agent";
import { AithyRuntimeAcpBridge } from "../src/acp/runtime-bridge";
import { LiveEventHub } from "../src/web/live-events";

describe("Aithy ACP agent", () => {
  test("handles initialize, newSession, and prompt over ACP", async () => {
    const { client, bridge, updates, close } = connectFakeAithy();

    try {
      const initialized = await client.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      expect(initialized).toMatchObject({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: false,
        },
      });

      const session = await client.newSession({
        cwd: "/tmp/project",
        mcpServers: [],
      });
      expect(session.sessionId).toBe("acp-session");

      const response = await client.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello from acp" }],
      });

      expect(response.stopReason).toBe("end_turn");
      expect(bridge.prompts).toEqual([
        { sessionId: "acp-session", text: "hello from acp" },
      ]);
      expect(updates).toContainEqual({
        sessionId: "acp-session",
        text: "assistant from fake bridge",
      });
    } finally {
      await close();
    }
  });

  test("cancels without sending a final assistant update", async () => {
    const { client, bridge, updates, close } = connectFakeAithy({
      runPrompt: ({ signal }) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            resolve({ cancelled: true });
          }, { once: true });
        }),
    });

    try {
      const session = await client.newSession({
        cwd: "/tmp/project",
        mcpServers: [],
      });
      const prompt = client.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "stop me" }],
      });

      await client.cancel({ sessionId: session.sessionId });

      await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
      expect(bridge.cancelled).toEqual(["acp-session"]);
      expect(updates).toEqual([]);
    } finally {
      await close();
    }
  });

  test("runtime bridge maps ACP sessions and disables system.bash jobs", async () => {
    const runtime = fakeRuntime();
    const bridge = new AithyRuntimeAcpBridge(async () => runtime as any);

    const session = await bridge.createSession({
      cwd: "/tmp/project",
      mcpServers: [],
    });
    const reply = await bridge.runPrompt({
      sessionId: session.sessionId,
      text: "hello through runtime",
    });

    expect(reply).toEqual({ text: "runtime reply" });
    expect(runtime.ensured[0]).toMatchObject({
      conversationId: `acp-${session.sessionId}`,
      source: "acp",
    });
    expect(runtime.enqueued[0]).toMatchObject({
      conversationId: `acp-${session.sessionId}`,
      text: "hello through runtime",
      skillIds: [],
      disableSystemBash: true,
    });
    expect(runtime.messages[0]).toMatchObject({
      conversationId: `acp-${session.sessionId}`,
      content: "hello through runtime",
    });
  });

  test("runtime bridge ignores stale assistant text after cancellation", async () => {
    const runtime = fakeRuntime({ autoReply: false });
    const bridge = new AithyRuntimeAcpBridge(async () => runtime as any);
    const session = await bridge.createSession({
      cwd: "/tmp/project",
      mcpServers: [],
    });
    const oldConversationId = `acp-${session.sessionId}`;

    await bridge.cancel(session.sessionId);
    const prompt = bridge.runPrompt({
      sessionId: session.sessionId,
      text: "second prompt",
    });
    await waitUntil(() => runtime.enqueued.length === 1);

    runtime.publishAssistant(oldConversationId, "stale cancelled reply");
    runtime.publishAssistant(`acp-${session.sessionId}-1`, "fresh reply");

    await expect(prompt).resolves.toEqual({ text: "fresh reply" });
  });

  test("runtime bridge ignores assistant events before the prompt row advances", async () => {
    const runtime = fakeRuntime({ autoReply: false });
    const bridge = new AithyRuntimeAcpBridge(async () => runtime as any);
    const session = await bridge.createSession({
      cwd: "/tmp/project",
      mcpServers: [],
    });
    const conversationId = `acp-${session.sessionId}`;
    const prompt = bridge.runPrompt({
      sessionId: session.sessionId,
      text: "position-gated prompt",
    });
    await waitUntil(() => runtime.enqueued.length === 1);

    runtime.publishAssistant(conversationId, "too early", { advanceRow: false });
    runtime.publishAssistant(conversationId, "position-gated reply");

    await expect(prompt).resolves.toEqual({ text: "position-gated reply" });
  });

  test("runtime bridge shuts down a created runtime", async () => {
    const runtime = fakeRuntime();
    const bridge = new AithyRuntimeAcpBridge(async () => runtime as any);

    await bridge.createSession({
      cwd: "/tmp/project",
      mcpServers: [],
    });
    await bridge.shutdown();

    expect(runtime.shutdowns).toBe(1);
  });
});

function connectFakeAithy(overrides: Partial<AithyAcpBridge> = {}) {
  const clientToAgent = new PassThrough();
  const agentToClient = new PassThrough();
  const updates: Array<{ sessionId: string; text: string }> = [];
  const bridge = new FakeBridge(overrides);

  const agentStream = acp.ndJsonStream(
    Writable.toWeb(agentToClient),
    Readable.toWeb(clientToAgent) as unknown as ReadableStream<Uint8Array>,
  );
  const clientStream = acp.ndJsonStream(
    Writable.toWeb(clientToAgent),
    Readable.toWeb(agentToClient) as unknown as ReadableStream<Uint8Array>,
  );

  const agentConnection = new acp.AgentSideConnection(
    (connection) => new AithyAcpAgent(connection, bridge),
    agentStream,
  );
  const client = new acp.ClientSideConnection(() => ({
    async requestPermission() {
      return { outcome: { outcome: "cancelled" } };
    },
    async sessionUpdate(params) {
      const update = params.update;
      if (
        update.sessionUpdate === "agent_message_chunk"
        && update.content.type === "text"
      ) {
        updates.push({ sessionId: params.sessionId, text: update.content.text });
      }
    },
    async readTextFile() {
      return { content: "" };
    },
    async writeTextFile() {
      return {};
    },
  }), clientStream);

  return {
    client,
    bridge,
    updates,
    close: async () => {
      clientToAgent.destroy();
      agentToClient.destroy();
      await agentConnection.closed.catch(() => {});
    },
  };
}

class FakeBridge implements AithyAcpBridge {
  prompts: Array<{ sessionId: string; text: string }> = [];
  cancelled: string[] = [];

  constructor(private readonly overrides: Partial<AithyAcpBridge>) {}

  async createSession() {
    return { sessionId: "acp-session" };
  }

  async runPrompt(input: AithyAcpRunPromptInput) {
    this.prompts.push({ sessionId: input.sessionId, text: input.text });
    if (this.overrides.runPrompt) return this.overrides.runPrompt(input);
    return { text: "assistant from fake bridge" };
  }

  async cancel(sessionId: string) {
    this.cancelled.push(sessionId);
    await this.overrides.cancel?.(sessionId);
  }
}

function fakeRuntime(options: { autoReply?: boolean } = {}) {
  const autoReply = options.autoReply ?? true;
  const live = new LiveEventHub();
  const enqueued: any[] = [];
  const ensured: any[] = [];
  const messages: any[] = [];
  const lastMessageIds = new Map<string, number>();
  let shutdowns = 0;
  const nextMessageId = (conversationId: string) => {
    const next = (lastMessageIds.get(conversationId) ?? 0) + 1;
    lastMessageIds.set(conversationId, next);
    return next;
  };
  const publishAssistant = (
    conversationId: string,
    content: string,
    publishOptions: { advanceRow?: boolean } = {},
  ) => {
    if (publishOptions.advanceRow !== false) nextMessageId(conversationId);
    live.publish({
      type: "message",
      id: crypto.randomUUID(),
      conversationId,
      createdAt: new Date().toISOString(),
      message: {
        role: "assistant",
        kind: "text",
        content,
        createdAt: new Date().toISOString(),
      },
    });
  };
  return {
    live,
    enqueued,
    ensured,
    messages,
    publishAssistant,
    get shutdowns() {
      return shutdowns;
    },
    sessions: {
      ensureLogicalSession(conversationId: string, options: any) {
        ensured.push({ conversationId, ...options });
      },
      appendMessages(conversationId: string, input: any[]) {
        nextMessageId(conversationId);
        messages.push({ conversationId, content: input[0]?.content });
      },
      lastMessageId(conversationId: string) {
        return lastMessageIds.get(conversationId) ?? null;
      },
    },
    sessionState: {
      async flush() {},
    },
    dispatcher: {
      async enqueueUserChat(data: any) {
        enqueued.push(data);
        if (autoReply) queueMicrotask(() => publishAssistant(data.conversationId, "runtime reply"));
        return { jobId: "job", conversationId: data.conversationId };
      },
      async cancelByConversation() {
        return 0;
      },
    },
    assertReady() {},
    async shutdown() {
      shutdowns += 1;
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for test condition");
}
