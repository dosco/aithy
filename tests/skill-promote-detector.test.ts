import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { detectRepeatPatterns } from "../src/skills/promote-detector";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("detectRepeatPatterns", () => {
  test("groups repeated tool calls and keeps bounded examples", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "aithy-promote-det-"));
    const dbPath = path.join(dir, "state.db");
    const state = new SqliteSessionStateStore(dbPath);
    const now = Date.now();
    state.ensureSession({
      conversationId: "session-a",
      name: "test",
      nameSource: "generated",
      source: "test",
      now: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000),
    });

    for (let i = 0; i < 6; i += 1) {
      state.appendMessages("session-a", [
        {
          role: "assistant",
          kind: "tool_call",
          toolName: "sandbox.bash",
          toolArgs: { command: `bun ${i % 2 === 0 ? "test" : "run typecheck"}`, cwd: "/workspace" },
          toolResult: { exitCode: 0 },
          createdAt: new Date(now + i * 1000).toISOString(),
        },
      ]);
    }
    state.close();

    const db = new Database(dbPath, { readonly: true });
    const patterns = detectRepeatPatterns(db);
    db.close();

    expect(patterns).toHaveLength(1);
    expect(patterns[0].signature).toBe("sandbox.bash|command|cwd|bun|");
    expect(patterns[0].count).toBe(6);
    expect(patterns[0].sourceSessionId).toBe("session-a");
    expect(patterns[0].sourceMessageId).toBe(6);
    expect(patterns[0].examples).toHaveLength(5);
    expect(patterns[0].examples[0].toolArgs).toMatchObject({ command: "bun run typecheck" });
  });
});
