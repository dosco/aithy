import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/env";
import { createConsolidatorAgent } from "../src/memory/consolidator-agent";
import { createMemoryAgent } from "../src/memory/memory-agent";
import { SqliteMemoryStore } from "../src/memory/memory-store";

describe("memory agents", () => {
  test("triage uses a direct tool-capable generator", async () => {
    const { config, memory } = await fixture();
    const agent = createMemoryAgent({ config, memory });
    const program = agent.program as any;

    expect(program.executor).toBeUndefined();
    expect(generatorDescription(program)).toContain("The ONLY way to save a memory");
    memory.close();
  });

  test("consolidator uses a direct tool-capable generator", async () => {
    const { config, memory } = await fixture();
    const agent = createConsolidatorAgent({ config, memory });
    const program = agent.program as any;

    expect(program.executor).toBeUndefined();
    expect(generatorDescription(program)).toContain("You are the memory consolidator");
    memory.close();
  });
});

async function fixture(): Promise<{ config: AppConfig; memory: SqliteMemoryStore }> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-memory-agent-"));
  const config = {
    aiProvider: "openai",
    aiApiKey: "sk-test",
    aiModel: "test",
    sandboxProvider: "disabled",
    sandboxImage: "python:3.11-slim",
    sandboxCpus: 1,
    sandboxMemoryMb: 512,
    sandboxNetwork: "none",
    sessionTtlMs: 1000,
    idleParkMs: 60_000,
    parallelAgents: 1,
    workspaceRoot: dir,
    botId: "default",
    stateDir: dir,
    stateDbPath: path.join(dir, "state.db"),
    traceEnabled: false,
    tracesDir: path.join(dir, "traces"),
    globalMounts: [],
  } as AppConfig;
  return { config, memory: new SqliteMemoryStore(config.stateDbPath) };
}

function generatorDescription(program: any): string {
  return program.getSignature().getDescription();
}
