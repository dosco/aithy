import { describe, expect, test } from "bun:test";
import { buildMemoryHelp } from "../app/components/mind/memory-help";
import {
  isQuietMemoryRunSummary,
  memoryRunSummaryForDisplay,
} from "../app/components/mind/memory-run-display";
import type { MemoryRunDto } from "../app/server/dto";

describe("memory UI helpers", () => {
  test("buildMemoryHelp explains recall, labels, validity, and evidence", () => {
    const help = buildMemoryHelp({
      kind: "preference",
      labels: ["personal", "media"],
      validFrom: "2026-05-01",
      validUntil: "2026-05-31",
      evidence: "The user said they prefer documentaries.",
      frequency: null,
      retrievedCount: 3,
      lastRecalledAt: "2026-05-17T12:34:56.000Z",
    });

    expect(help.summary).toBe(
      "Can be recalled as preference context for personal context and media tastes.",
    );
    expect(help.details).toContain("Recalled 3 times; last recalled 2026-05-17");
    expect(help.details).toContain("Applies 2026-05-01 through 2026-05-31");
    expect(help.details).toContain("Supported by saved evidence");
  });

  test("buildMemoryHelp is honest when a memory has not been recalled", () => {
    const help = buildMemoryHelp({
      kind: "fact",
      labels: [],
      validFrom: null,
      validUntil: null,
      evidence: null,
      frequency: null,
      retrievedCount: 0,
      lastRecalledAt: null,
    });

    expect(help.summary).toBe(
      "Can be recalled as factual context when a related request matches it.",
    );
    expect(help.details).toEqual(["Not recalled yet"]);
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
