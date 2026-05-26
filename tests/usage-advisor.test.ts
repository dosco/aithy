import { describe, expect, test } from "bun:test";
import { buildUsageAdvisor, type UsageRunOutcome } from "../src/usage/advisor";
import type { UsageRecord } from "../src/usage/types";

describe("usage advisor", () => {
  test("groups by component/provider/model and computes token mix", () => {
    const advisor = buildUsageAdvisor({
      records: [
        usage({ runId: "r1", provider: "openai", model: "small", component: "chat.actor", totalTokens: 100, inputTokens: 60, outputTokens: 20, thoughtTokens: 20, cacheReadTokens: 30 }),
        usage({ runId: "r1", provider: "openai", model: "small", component: "chat.actor", totalTokens: 50, inputTokens: 20, outputTokens: 25, thoughtTokens: 5, stage: "task" }),
      ],
      outcomes: [outcome("r1", "completed")],
    });

    expect(advisor.rows).toHaveLength(1);
    expect(advisor.rows[0]).toMatchObject({
      component: "chat.actor",
      provider: "openai",
      model: "small",
      runs: 1,
      successfulRuns: 1,
      tokensPerRun: 150,
      tokensPerSuccessfulRun: 150,
      cacheShare: 38,
      outputThoughtRatio: 1.8,
      reliability: "known",
      label: "not enough samples",
    });
    expect(advisor.rows[0].stages).toEqual(["ctx", "task"]);
  });

  test("marks rows without task outcomes as unknown reliability", () => {
    const advisor = buildUsageAdvisor({
      records: [usage({ runId: "memory-run", component: "memory.triage", totalTokens: 10 })],
      outcomes: [],
    });

    expect(advisor.rows[0]).toMatchObject({
      reliability: "unknown",
      unknownRuns: 1,
      successfulRuns: 0,
      tokensPerSuccessfulRun: null,
    });
  });

  test("recommends a clear efficient and stable winner", () => {
    const records: UsageRecord[] = [];
    const outcomes: UsageRunOutcome[] = [];
    for (let i = 0; i < 20; i += 1) {
      records.push(usage({ id: i + 1, runId: `small-${i}`, model: "small", component: "chat.responder", totalTokens: 100 }));
      outcomes.push(outcome(`small-${i}`, "completed"));
      records.push(usage({ id: i + 101, runId: `large-${i}`, model: "large", component: "chat.responder", totalTokens: 180 }));
      outcomes.push(outcome(`large-${i}`, "completed"));
    }

    const advisor = buildUsageAdvisor({ records, outcomes });
    const small = advisor.rows.find((row) => row.model === "small");
    const large = advisor.rows.find((row) => row.model === "large");

    expect(small?.label).toBe("recommended");
    expect(small?.confidence).toBe("confident");
    expect(large?.label).toBe("stable but costly");
  });

  test("uses tentative efficient label before enough confident samples", () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      usage({ id: i + 1, runId: `r${i}`, component: "chat.actor", totalTokens: 50 }));
    const outcomes = records.map((record) => outcome(record.runId!, "completed"));

    expect(buildUsageAdvisor({ records, outcomes }).rows[0]).toMatchObject({
      label: "efficient",
      confidence: "tentative",
    });
  });

  test("flags high retry or failure rows", () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      usage({ id: i + 1, runId: `r${i}`, component: "chat.actor", totalTokens: 50 }));
    const outcomes: UsageRunOutcome[] = [
      outcome("r0", "completed"),
      outcome("r1", "failed"),
      outcome("r2", "completed", 2),
      outcome("r3", "completed"),
      outcome("r4", "completed"),
    ];

    expect(buildUsageAdvisor({ records, outcomes }).rows[0].label).toBe("watch retries");
  });
});

function usage(patch: Partial<UsageRecord>): UsageRecord {
  return {
    id: 1,
    provider: "openai",
    model: "gpt-test",
    purpose: "chat",
    component: "chat.actor",
    stage: "ctx",
    inputTokens: 10,
    outputTokens: 5,
    thoughtTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 15,
    sessionId: "s1",
    runId: "r1",
    occurredAt: "2026-05-25T00:00:00.000Z",
    ...patch,
  };
}

function outcome(runId: string, status: UsageRunOutcome["status"], attempt = 1): UsageRunOutcome {
  return { runId, status, attempt, retryOfTaskId: attempt > 1 ? "prior" : null };
}
