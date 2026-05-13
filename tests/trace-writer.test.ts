import { mkdtemp, readFile, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import {
  appendChatLogToTraces,
  traceFilenameFor,
  type TurnTraceChatLog,
} from "../src/agent/trace-writer";

function makeConfig(tracesDir: string): AppConfig {
  return {
    aiProvider: "openai",
    aiModel: "gpt-4o",
    sandboxProvider: "disabled",
    sandboxImage: "x",
    sandboxCpus: 1,
    sandboxMemoryMb: 1,
    sandboxNetwork: "none",
    sessionTtlMs: 1000,
    idleParkMs: 60_000,
    parallelAgents: 1,
    parallelSearchMcpUrl: "https://search.parallel.ai/mcp",
    workspaceRoot: "/tmp/ws",
    botId: "default",
    stateDir: "/tmp/state",
    stateDbPath: "/tmp/state/default/state.db",
    traceEnabled: true,
    tracesDir,
    globalMounts: [],
  };
}

const caseAChatLog: TurnTraceChatLog = {
  actor: [
    {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "explorer system" },
        { role: "user", content: "explore" },
        { role: "assistant", content: "explorer reply" },
      ],
      stage: "ctx",
    },
    {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "task system" },
        { role: "user", content: "do work" },
        { role: "assistant", content: "task reply" },
      ],
      stage: "task",
    },
  ],
  responder: [
    {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "distiller system" },
        { role: "user", content: "distill" },
        { role: "assistant", content: "distilled" },
      ],
      stage: "ctx",
    },
    {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "responder system" },
        { role: "user", content: "respond" },
        { role: "assistant", content: "final" },
      ],
      stage: "task",
    },
  ],
};

describe("traceFilenameFor", () => {
  test("maps Case A pipeline+stage tuples to component file names", () => {
    expect(traceFilenameFor("actor", "ctx")).toBe("context-explorer.jsonl");
    expect(traceFilenameFor("actor", "task")).toBe("task-executor.jsonl");
    expect(traceFilenameFor("responder", "ctx")).toBe("context-distiller.jsonl");
    expect(traceFilenameFor("responder", "task")).toBe("final-responder.jsonl");
  });

  test("falls back to generic names when stage is undefined", () => {
    expect(traceFilenameFor("actor", undefined)).toBe("actor.jsonl");
    expect(traceFilenameFor("responder", undefined)).toBe("final-responder.jsonl");
  });
});

describe("appendChatLogToTraces", () => {
  test("writes one file per pipeline component, each line is {messages: [...]}", async () => {
    const tracesDir = path.join(await mkdtemp(path.join(tmpdir(), "aithy-trace-")), "traces");
    await appendChatLogToTraces(makeConfig(tracesDir), caseAChatLog, new EventBus());

    const entries = (await readdir(tracesDir)).sort();
    expect(entries).toEqual([
      "context-distiller.jsonl",
      "context-explorer.jsonl",
      "final-responder.jsonl",
      "task-executor.jsonl",
    ]);

    for (const file of entries) {
      const body = await readFile(path.join(tracesDir, file), "utf8");
      const lines = body.trim().split("\n");
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      expect(Object.keys(parsed)).toEqual(["messages"]);
      expect(Array.isArray(parsed.messages)).toBe(true);
    }
  });

  test("appends to existing files across multiple turns", async () => {
    const tracesDir = path.join(await mkdtemp(path.join(tmpdir(), "aithy-trace-")), "traces");
    const config = makeConfig(tracesDir);
    const events = new EventBus();
    await appendChatLogToTraces(config, caseAChatLog, events);
    await appendChatLogToTraces(config, caseAChatLog, events);

    const body = await readFile(path.join(tracesDir, "context-explorer.jsonl"), "utf8");
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("does nothing when chat log is empty", async () => {
    const tracesDir = path.join(await mkdtemp(path.join(tmpdir(), "aithy-trace-")), "traces");
    await appendChatLogToTraces(
      makeConfig(tracesDir),
      { actor: [], responder: [] },
      new EventBus(),
    );
    let entries: string[] = [];
    try {
      entries = await readdir(tracesDir);
    } catch {
      // dir not created — that's fine
    }
    expect(entries).toEqual([]);
  });

  test("emits an error event and does not throw when writing fails", async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), "aithy-trace-"));
    await chmod(stateRoot, 0o400);
    const tracesDir = path.join(stateRoot, "traces");
    const events = new EventBus();
    const seen: string[] = [];
    events.subscribe((e) => {
      if (e.type === "error") seen.push(e.message);
    });
    await appendChatLogToTraces(makeConfig(tracesDir), caseAChatLog, events);
    await chmod(stateRoot, 0o755).catch(() => {});
    expect(seen.some((m) => m.startsWith("trace-writer:"))).toBe(true);
  });
});
