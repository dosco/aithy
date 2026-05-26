import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageAdvisorPanel } from "../app/components/usage-advisor-panel";
import { TrainingDataPanel } from "../app/components/usage-training-data-panel";
import type { UsageAdvisorDto } from "../app/server/dto";

describe("UsageAdvisorPanel", () => {
  test("renders recommendation cards, matrix, and explanations", () => {
    const html = renderToStaticMarkup(<UsageAdvisorPanel advisor={advisor()} />);

    expect(html).toContain("usage advisor");
    expect(html).toContain("chat.actor");
    expect(html).toContain("recommended");
    expect(html).toContain("tokens/run");
    expect(html).toContain("Best observed fit");
  });

  test("renders empty state", () => {
    const html = renderToStaticMarkup(<UsageAdvisorPanel advisor={{ rows: [], components: [] }} />);

    expect(html).toContain("no advisor samples yet");
  });
});

describe("TrainingDataPanel", () => {
  test("does not expose DPO export in the visible v1 workflow", () => {
    const html = renderToStaticMarkup(
      <TrainingDataPanel
        stats={{
          captureEnabled: true,
          traceCount: 3,
          sftExampleCount: 3,
          preferencePairCount: 2,
          sessionCount: 1,
          earliestAt: null,
          latestAt: null,
          byComponent: [],
          byModel: [],
          bySession: [],
        }}
        onStatsChange={() => {}}
      />,
    );

    expect(html).toContain("SFT");
    expect(html).not.toContain("DPO");
  });
});

function advisor(): UsageAdvisorDto {
  const row = {
    component: "chat.actor",
    stage: "ctx" as const,
    stages: ["ctx" as const],
    provider: "openai",
    model: "gpt-test",
    inputTokens: 100,
    outputTokens: 50,
    thoughtTokens: 25,
    cacheCreationTokens: 0,
    cacheReadTokens: 50,
    totalTokens: 175,
    runs: 20,
    successfulRuns: 20,
    failedRuns: 0,
    cancelledRuns: 0,
    unknownRuns: 0,
    retryCount: 0,
    tokensPerRun: 9,
    tokensPerSuccessfulRun: 9,
    cacheShare: 50,
    outputThoughtRatio: 2,
    latestSeenAt: "2026-05-25T00:00:00.000Z",
    label: "recommended" as const,
    confidence: "confident" as const,
    reliability: "known" as const,
    explanation: "Best observed fit for chat.actor: 9 tokens per successful run with enough samples.",
  };
  return {
    rows: [row],
    components: [{ component: "chat.actor", rows: [row], recommendation: row }],
  };
}
