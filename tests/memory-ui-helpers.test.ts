import { describe, expect, test } from "bun:test";
import { buildMemoryHelp } from "../app/components/mind/memory-help";
import {
  chatTextFragmentHref,
  parseMemoryEvidence,
  shortSessionId,
} from "../app/components/mind/memory-evidence";
import {
  isQuietMemoryRunSummary,
  memoryRunSummaryForDisplay,
} from "../app/components/mind/memory-run-display";
import type { MemoryRunDto } from "../app/server/dto";
import { MEMORY_KINDS } from "../src/memory/types";

describe("memory UI helpers", () => {
  test("buildMemoryHelp explains recall, type, validity, and evidence", () => {
    const help = buildMemoryHelp({
      kind: "preference",
      subject: "user",
      scopeKind: "global",
      scopeRef: null,
      guidance: "context",
      validFrom: "2026-05-01",
      validUntil: "2026-05-31",
      evidence: "The user said they prefer documentaries.",
      frequency: null,
      retrievedCount: 3,
      lastRecalledAt: "2026-05-17T12:34:56.000Z",
    });

    expect(help.summary).toBe(
      "Can be recalled as user preference context when a related request and scope match it.",
    );
    expect(help.details).toContain("Recalled 3 times; last recalled 2026-05-17");
    expect(help.details).toContain("Global scope");
    expect(help.details).toContain("Advisory context");
    expect(help.details).toContain("Applies 2026-05-01 through 2026-05-31");
    expect(help.details).toContain("Supported by saved evidence");
  });

  test("buildMemoryHelp is honest when a memory has not been recalled", () => {
    const help = buildMemoryHelp({
      kind: "fact",
      subject: "user",
      scopeKind: "global",
      scopeRef: null,
      guidance: "context",
      validFrom: null,
      validUntil: null,
      evidence: null,
      frequency: null,
      retrievedCount: 0,
      lastRecalledAt: null,
    });

    expect(help.summary).toBe(
      "Can be recalled as user factual context when a related request and scope match it.",
    );
    expect(help.details).toEqual(["Not recalled yet", "Global scope", "Advisory context"]);
  });

  test("buildMemoryHelp handles every memory kind", () => {
    for (const kind of MEMORY_KINDS) {
      const help = buildMemoryHelp({
        kind,
        subject: "user",
        scopeKind: "global",
        scopeRef: null,
        guidance: "context",
        validFrom: null,
        validUntil: null,
        evidence: null,
        frequency: null,
        retrievedCount: 0,
        lastRecalledAt: null,
      });
      expect(help.summary).toContain("when a related request and scope match it");
    }
  });

  test("parseMemoryEvidence extracts friendly session evidence", () => {
    const parsed = parseMemoryEvidence(
      "In session cc639770-8e2c-48b4-b265-666f44cca5f9, the user said: i like coffee, really like it",
    );

    expect(parsed).toEqual({
      kind: "user_quote",
      text: "i like coffee, really like it",
      sourceLabel: "You said",
      sessionId: "cc639770-8e2c-48b4-b265-666f44cca5f9",
    });
    expect(shortSessionId(parsed!.sessionId!)).toBe("a5f9");
  });

  test("chatTextFragmentHref links to chat with encoded source text", () => {
    expect(chatTextFragmentHref(
      "cc639770-8e2c-48b4-b265-666f44cca5f9",
      "i like coffee, really like it",
    )).toBe(
      "/chat/cc639770-8e2c-48b4-b265-666f44cca5f9#:~:text=i%20like%20coffee%2C%20really%20like%20it",
    );
    expect(chatTextFragmentHref("session-a", "foo-bar")).toBe(
      "/chat/session-a#:~:text=foo%2Dbar",
    );
  });

  test("parseMemoryEvidence leaves plain evidence readable", () => {
    expect(parseMemoryEvidence("User said they run everything with bun.")).toEqual({
      kind: "plain",
      text: "User said they run everything with bun.",
      sourceLabel: "Evidence",
      sessionId: null,
    });
  });

  test("quiet memory run summaries are hidden from the prominent ribbon line", () => {
    expect(isQuietMemoryRunSummary("nothing to remember")).toBe(true);
    expect(isQuietMemoryRunSummary("store too small to consolidate")).toBe(true);
    expect(isQuietMemoryRunSummary("no-op: nothing to consolidate")).toBe(true);
    expect(isQuietMemoryRunSummary("Saved to memory: likes coffee")).toBe(false);

    expect(memoryRunSummaryForDisplay(run({ summary: "nothing to remember" }), "idle")).toBeNull();
    expect(memoryRunSummaryForDisplay(run({ summary: "Saved to memory: likes coffee" }), "idle"))
      .toBe("Saved to memory: likes coffee");
  });
});

function run(input: { summary?: string | null; error?: string | null }): MemoryRunDto {
  return {
    id: "run-1",
    sessionId: "session-1",
    trigger: "auto",
    status: input.error ? "failed" : "completed",
    startedAt: "2026-05-17T12:00:00.000Z",
    completedAt: "2026-05-17T12:00:01.000Z",
    msElapsed: 1000,
    summary: input.summary ?? null,
    error: input.error ?? null,
    childSessionId: null,
  };
}
