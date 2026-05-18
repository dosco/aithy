import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AxAgentClarificationError } from "@ax-llm/ax";
import { describe, expect, test } from "bun:test";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { runMessage } from "../src/agent/run-message";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { MessagePageInput, SessionStateStore, StoredSession } from "../src/session/state-store";
import type { BotMessage, BotSessionSummary } from "../src/session/types";

describe("runMessage", () => {
  test("passes prior user and assistant turns to the next agent call", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const events = new EventBus();
    const sandbox = new MockSandboxProvider();
    const sessions = new SessionManager({ sandbox, botId: "default", workspaceRoot: root, events, ttlMs: 1000 });
    const seenInputs: any[] = [];

    const deps = {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events,
      sandbox,
      sessions,
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            seenInputs.push(input);
            return {
              agentResponse: input.userRequest === "remember this" ? "stored" : "checking"
            };
          },
          getState: () => ({ saved: true })
        }
      })
    };

    await runMessage(textMessage("m1", "remember this"), deps);
    await runMessage(textMessage("m2", "what did I say?"), deps);

    expect(seenInputs[0].conversationHistory).toBeUndefined();
    expect(seenInputs[1].conversationHistory).toContain("user: remember this");
    expect(seenInputs[1].conversationHistory).toContain("assistant: stored");
    expect(
      seenInputs[1].conversationHistory.includes("what did I say?"),
    ).toBe(false);
  });

  test("persists transcript across SessionManager restarts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const dbPath = path.join(root, "state.db");
    const firstSeen: any[] = [];
    await runMessage(textMessage("m1", "remember this"), depsFor(root, dbPath, firstSeen));

    const secondSeen: any[] = [];
    await runMessage(textMessage("m2", "what did I say?"), depsFor(root, dbPath, secondSeen));

    expect(firstSeen[0].conversationHistory).toBeUndefined();
    expect(secondSeen[0].conversationHistory).toContain("user: remember this");
    expect(secondSeen[0].conversationHistory).toContain("assistant: stored");
  });

  test("reads stored transcripts without recreating the live session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const dbPath = path.join(root, "state.db");
    const seen: any[] = [];
    await runMessage(textMessage("m1", "remember this"), depsFor(root, dbPath, seen));

    const sessions = sessionsFor(root, dbPath);
    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "remember this" },
      { role: "assistant", content: "stored" },
    ]);
  });

  test("uses a pre-persisted web user turn without duplicating it in history", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const dbPath = path.join(root, "state.db");
    const sessions = sessionsFor(root, dbPath);
    const message = textMessage("m1", "queued turn");
    sessions.ensureLogicalSession(message.conversationId);
    sessions.appendMessages(message.conversationId, [{
      role: "user",
      content: message.text,
      createdAt: message.createdAt.toISOString(),
    }]);
    const seenInputs: any[] = [];

    const reply = await runMessage(message, {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      userMessagePersisted: true,
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            seenInputs.push(input);
            return { agentResponse: "queued reply" };
          },
        },
      }),
    });

    expect(reply.text).toBe("queued reply");
    expect(seenInputs[0].conversationHistory).toBeUndefined();
    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "queued turn" },
      { role: "assistant", content: "queued reply" },
    ]);
  });

  test("returns the clarification question without retaining agent state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const dbPath = path.join(root, "state.db");
    const pausedState = {
      version: 1,
      runtimeBindings: { awaiting: "details" },
      runtimeEntries: [],
      actionLogEntries: [],
      provenance: {},
    } as any;
    const sessions = sessionsFor(root, dbPath);
    const setStates: unknown[] = [];
    let calls = 0;

    const clarifyEvents = new EventBus();
    const deps = {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events: clarifyEvents,
      sandbox: new MockSandboxProvider(),
      sessions,
      agentFactory: () => ({
        llm: {},
        program: {
          setState: (state: unknown) => setStates.push(state),
          forward: async () => {
            calls += 1;
            if (calls === 1) {
              throw new AxAgentClarificationError("Which detail?", {
                state: pausedState,
              });
            }
            return { agentResponse: "answered" };
          },
        },
      }),
    };

    const question = await runMessage(textMessage("m1", "start"), deps);
    const answer = await runMessage(textMessage("m2", "the detail"), deps);

    expect(question.text).toBe("Which detail?");
    expect(answer.text).toBe("answered");
    expect(setStates).toEqual([]);
  });

  test("passes selected skills to the agent forward options", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const seenOptions: any[] = [];
    const deps = {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions: sessionsFor(root, path.join(root, "state.db")),
      skills: [{ name: "shell-helper", content: "Use boring shell commands." }],
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, _input: any, options: any) => {
            seenOptions.push(options);
            return { agentResponse: "used skill" };
          },
        },
      }),
    };

    await runMessage(textMessage("m1", "use this"), deps);

    expect(seenOptions).toEqual([
      { skills: [{ name: "shell-helper", content: "Use boring shell commands." }] },
    ]);
  });

  test("emits and persists tool calls from the agent callback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const events = new EventBus();
    const emitted: unknown[] = [];
    events.subscribe((event) => emitted.push(event));
    const sessions = sessionsFor(root, path.join(root, "state.db"));

    await runMessage(textMessage("m1", "run pwd"), {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events,
      sandbox: new MockSandboxProvider(),
      sessions,
      agentFactory: (options: any) => ({
        llm: {},
        program: {
          forward: async () => {
            options.onFunctionCall({
              name: "final",
              qualifiedName: "final",
              args: { response: "done" },
              kind: "internal",
            });
            options.onFunctionCall({
              name: "bash",
              qualifiedName: "sandbox.bash",
              args: { command: "pwd" },
              kind: "external",
            });
            return { agentResponse: "done" };
          },
        },
      }),
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "agent.tool_call",
        conversationId: "conversation",
        message: expect.objectContaining({
          kind: "tool_call",
          toolName: "sandbox.bash",
          toolArgs: { command: "pwd" },
        }),
      }),
    );
    const toolEvent = emitted.find((event: any) => event.type === "agent.tool_call") as any;
    expect(toolEvent.message.toolResult).toBeUndefined();
    expect(emitted).not.toContainEqual(
      expect.objectContaining({
        type: "agent.tool_call",
        message: expect.objectContaining({ toolName: "final" }),
      }),
    );
    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "run pwd" },
      {
        role: "assistant",
        kind: "tool_call",
        toolName: "sandbox.bash",
        toolArgs: { command: "pwd" },
      },
      { role: "assistant", kind: "text", content: "done" },
    ]);
  });

  test("emits and persists skill and memory search debug rows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const events = new EventBus();
    const emitted: unknown[] = [];
    events.subscribe((event) => emitted.push(event));
    const sessions = sessionsFor(root, path.join(root, "state.db"));

    await runMessage(textMessage("m1", "look it up"), {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events,
      sandbox: new MockSandboxProvider(),
      sessions,
      skillsSearch: async (queries) => [{
        name: "coffee-finder",
        content: `Use maps for ${queries.join(", ")}`,
      }],
      memory: {
        search: async () => [{
          id: "mem-1",
          kind: "fact",
          title: "Favorite city",
          body: "The user often asks about Vancouver.",
          labels: ["personal"],
          validFrom: null,
          validUntil: null,
          durationDays: null,
          evidence: null,
          frequency: null,
          source: null,
          importance: 0.7,
          createdAt: "2026-04-30T00:00:00.000Z",
          updatedAt: "2026-04-30T00:00:00.000Z",
          lastRecalledAt: null,
          recallCount: 0,
          retrievedCount: 0,
          supersededBy: null,
        }],
      } as any,
      agentFactory: (options: any) => ({
        llm: {},
        program: {
          forward: async () => {
            await options.onSkillsSearch(["coffee"]);
            await options.onMemoriesSearch(["Vancouver"], []);
            return { agentResponse: "done" };
          },
        },
      }),
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "agent.tool_call",
        message: expect.objectContaining({
          toolName: "skills.search",
          toolArgs: { queries: ["coffee"] },
          toolResult: {
            matches: [{
              name: "coffee-finder",
              contentBytes: 19,
              contentPreview: "Use maps for coffee",
            }],
          },
        }),
      }),
    );
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "agent.tool_call",
        message: expect.objectContaining({
          toolName: "memory.recall",
          toolArgs: { queries: ["Vancouver"], excludeIds: [] },
          toolResult: {
            matches: [expect.objectContaining({
              id: "memory:mem-1",
              contentPreview: expect.stringContaining("Favorite city"),
            })],
          },
        }),
      }),
    );
    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "look it up" },
      { role: "assistant", kind: "tool_call", toolName: "skills.search" },
      { role: "assistant", kind: "tool_call", toolName: "memory.recall" },
      { role: "assistant", kind: "text", content: "done" },
    ]);
  });

  test("flushes remote session writes before enqueueing auto memory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-"));
    const dbPath = path.join(root, "state.db");
    const inner = new SqliteSessionStateStore(dbPath);
    let visibleLastMessageId: number | null = null;
    const sandbox = new MockSandboxProvider();
    const sessions = new SessionManager({
      sandbox,
      botId: "default",
      workspaceRoot: root,
      events: new EventBus(),
      ttlMs: 1000,
      state: new DelayedLastIdStore(inner, () => visibleLastMessageId),
    });
    const enqueued: string[] = [];

    await runMessage(textMessage("m1", "remember my favourite city is Vancouver"), {
      config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
      events: new EventBus(),
      sandbox,
      sessions,
      memoryQueue: {
        enqueueAuto: async (sessionId: string) => {
          enqueued.push(sessionId);
        },
      } as any,
      flushSessionState: async () => {
        visibleLastMessageId = inner.lastMessageId("conversation");
      },
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async () => ({ agentResponse: "I'll remember that." }),
        },
      }),
    });

    expect(Number(visibleLastMessageId)).toBe(2);
    expect(enqueued).toEqual(["conversation"]);
  });
});

class DelayedLastIdStore implements SessionStateStore {
  constructor(
    private readonly inner: SessionStateStore,
    private readonly readVisibleLastId: () => number | null,
  ) {}

  ensureSession(input: Parameters<SessionStateStore["ensureSession"]>[0]): void {
    this.inner.ensureSession(input);
  }
  loadSession(conversationId: string): StoredSession | undefined {
    return this.inner.loadSession(conversationId);
  }
  listSessions(): BotSessionSummary[] {
    return this.inner.listSessions();
  }
  findSessionsByName(name: string): BotSessionSummary[] {
    return this.inner.findSessionsByName(name);
  }
  getSummary(conversationId: string): BotSessionSummary | undefined {
    return this.inner.getSummary(conversationId);
  }
  renameSession(conversationId: string, name: string): void {
    this.inner.renameSession(conversationId, name);
  }
  clearSession(conversationId: string, now: string): void {
    this.inner.clearSession(conversationId, now);
  }
  deleteSession(conversationId: string): void {
    this.inner.deleteSession(conversationId);
  }
  deleteAllSessions(): void {
    this.inner.deleteAllSessions();
  }
  appendMessages(conversationId: string, messages: BotMessage[]): void {
    this.inner.appendMessages(conversationId, messages);
  }
  messagesPage(conversationId: string, input: MessagePageInput) {
    return this.inner.messagesPage(conversationId, input);
  }
  childSessions(parentId: string): BotSessionSummary[] {
    return this.inner.childSessions(parentId);
  }
  lastMessageId(_conversationId: string): number | null {
    return this.readVisibleLastId();
  }
  close(): void {
    this.inner.close?.();
  }
}

function depsFor(root: string, dbPath: string, seenInputs: any[]) {
  const sandbox = new MockSandboxProvider();
  const events = new EventBus();
  return {
    config: loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }),
    events,
    sandbox,
    sessions: new SessionManager({
      sandbox,
      botId: "default",
      workspaceRoot: root,
      events: new EventBus(),
      ttlMs: 1000,
      state: new SqliteSessionStateStore(dbPath),
    }),
    agentFactory: () => ({
      llm: {},
      program: {
        forward: async (_llm: unknown, input: any) => {
          seenInputs.push(input);
          return {
            agentResponse: input.userRequest === "remember this" ? "stored" : "checking",
          };
        },
        getState: () => ({ shouldNotPersist: true }),
      },
    }),
  };
}

function sessionsFor(root: string, dbPath: string): SessionManager {
  const sandbox = new MockSandboxProvider();
  return new SessionManager({
    sandbox,
    botId: "default",
    workspaceRoot: root,
    events: new EventBus(),
    ttlMs: 1000,
    state: new SqliteSessionStateStore(dbPath),
  });
}

function textMessage(id: string, text: string): ChannelMessage {
  return {
    id,
    channelId: "channel",
    conversationId: "conversation",
    senderId: "user",
    text,
    createdAt: new Date("2026-04-30T00:00:00Z"),
  };
}
