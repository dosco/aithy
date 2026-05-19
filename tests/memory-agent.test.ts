import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config/env";
import { createConsolidatorAgent } from "../src/memory/consolidator-agent";
import { createMemoryAgent } from "../src/memory/memory-agent";
import { buildMemoryAgentTools } from "../src/memory/agent-tools";
import { SqliteMemoryStore } from "../src/memory/memory-store";

describe("memory agents", () => {
  test("triage uses a direct tool-capable generator", async () => {
    const { config, memory } = await fixture();
    const agent = createMemoryAgent({ config, memory });
    const program = agent.program as any;

    expect(program.executor).toBeUndefined();
    expect(generatorDescription(program)).toContain("The ONLY way to save a memory");
    expect(generatorDescription(program)).toContain("bounded conversation segment");
    expect(generatorDescription(program)).toContain("context-only overlap");
    expect(generatorDescription(program)).toContain("dense, consolidated, self-contained");
    expect(generatorDescription(program)).toContain("include an explicit frequency");
    expect(generatorDescription(program)).toContain("validFrom, validUntil, durationDays, and evidence");
    expect(generatorDescription(program)).toContain("Those belong to dream episodes, not semantic memory");
    expect(generatorDescription(program)).toContain("I like coffee, really like it");
    expect(generatorDescription(program)).toContain("I might try cold brew someday");
    expect(generatorDescription(program)).toContain("I like this answer");
    expect(generatorDescription(program)).not.toContain("episode-like information");
    expect(generatorDescription(program)).toContain("0.3-0.45 for tentative interests");
    expect(generatorDescription(program)).toContain("'project_context'");
    expect(generatorDescription(program)).toContain("'vocabulary'");
    expect(generatorDescription(program)).not.toContain("LABELS:");
    memory.close();
  });

  test("consolidator uses a direct tool-capable generator", async () => {
    const { config, memory } = await fixture();
    const agent = createConsolidatorAgent({ config, memory });
    const program = agent.program as any;

    expect(program.executor).toBeUndefined();
    expect(generatorDescription(program)).toContain("You are the memory consolidator");
    expect(generatorDescription(program)).toContain("Exact duplicates");
    expect(generatorDescription(program)).toContain("Direct contradictions");
    expect(generatorDescription(program)).not.toContain("Event roll-ups");
    expect(generatorDescription(program)).not.toContain("Stale low-value rows");
    memory.close();
  });

  test("write tool dedupes candidates through memory search", async () => {
    const { config, memory } = await fixture();
    const existing = memory.upsert({
      kind: "fact",
      title: "uses bun runtime",
      body: "The user runs project commands with bun.",
    });
    const write = buildMemoryAgentTools({
      config,
      memory,
      dedupeDecider: { isDuplicate: async (_candidate, matches) => matches.length > 0 },
    }).find((tool) => tool.name === "write") as any;

    const duplicate = await write.func({
      kind: "fact",
      title: "uses bun runtime",
      body: "The user runs project commands with bun.",
    });
    const fresh = await write.func({
      kind: "fact",
      title: "uses sqlite",
      body: "The project stores session history in sqlite.",
    });

    expect(duplicate).toEqual({ id: existing.id, deduped: true, expired: false });
    expect(fresh.deduped).toBe(false);
    expect(memory.count()).toBe(2);
    expect(memory.get(existing.id)?.recallCount).toBe(0);
    expect(memory.get(existing.id)?.retrievedCount).toBe(0);
    memory.close();
  });

  test("write tool can bypass dedupe for consolidation", async () => {
    const { config, memory } = await fixture();
    memory.upsert({
      kind: "fact",
      title: "uses bun runtime",
      body: "The user runs project commands with bun.",
    });
    let dedupeCalls = 0;
    const write = buildMemoryAgentTools({
      config,
      memory,
      dedupeWrites: false,
      dedupeDecider: {
        isDuplicate: async () => {
          dedupeCalls += 1;
          return true;
        },
      },
    }).find((tool) => tool.name === "write") as any;

    const result = await write.func({
      kind: "fact",
      title: "uses bun runtime",
      body: "The user runs project commands with bun.",
    });

    expect(result.deduped).toBe(false);
    expect(dedupeCalls).toBe(0);
    expect(memory.count()).toBe(2);
    memory.close();
  });

  test("write tool stores time-bounded metadata and reports expired skips", async () => {
    const { config, memory } = await fixture();
    const write = buildMemoryAgentTools({
      config,
      memory,
      dedupeWrites: false,
    }).find((tool) => tool.name === "write") as any;

    const saved = await write.func({
      kind: "event",
      title: "future trip",
      body: "The user will travel to Tokyo.",
      validFrom: "2099-01-01",
      validUntil: "2099-01-03",
      durationDays: 200,
      evidence: "The user said Tokyo from Jan 1 through Jan 3.",
      frequency: "once",
    });
    const expired = await write.func({
      kind: "event",
      title: "past deadline",
      body: "The user's deadline already passed.",
      validUntil: "2000-01-01",
    });

    expect(saved).toEqual({ id: expect.any(String), deduped: false, expired: false });
    expect(memory.get(saved.id)?.durationDays).toBe(3);
    expect(memory.get(saved.id)?.evidence).toContain("Tokyo");
    expect(expired).toEqual({ id: "", deduped: false, expired: true });
    expect(memory.count()).toBe(1);
    memory.close();
  });

  test("write tool rejects invalid memory kinds", async () => {
    const { config, memory } = await fixture();
    const write = buildMemoryAgentTools({
      config,
      memory,
      dedupeWrites: false,
    }).find((tool) => tool.name === "write") as any;

    await expect(write.func({
      kind: "topic",
      title: "bad kind",
      body: "This should not persist.",
    })).rejects.toThrow("Invalid memory kind");
    expect(memory.count()).toBe(0);
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
    parallelSearchMcpUrl: "https://search.parallel.ai/mcp",
    workspaceRoot: dir,
    outboxRoot: path.join(dir, "outbox"),
    botId: "default",
    stateDir: dir,
    stateDbPath: path.join(dir, "state.db"),
    systemBashEnabled: true,
    traceEnabled: false,
    tracesDir: path.join(dir, "traces"),
    globalMounts: [],
  } as AppConfig;
  return { config, memory: new SqliteMemoryStore(config.stateDbPath) };
}

function generatorDescription(program: any): string {
  return program.getSignature().getDescription();
}
