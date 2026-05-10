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
});

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
