import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { completeAutomationRun } from "../src/automations/completion";
import { buildAutomationSchedule } from "../src/automations/schedule";
import { SqliteAutomationStore } from "../src/automations/store";
import type { AutomationAttentionType, AutomationSchedule, AutomationStatus } from "../src/automations/types";

describe("completeAutomationRun", () => {
  test("keeps paused automations paused after a manual completion", async () => {
    const store = await makeStore();
    const { automationId, runId } = seedRun(store, "paused");

    completeAutomationRun({
      automations: store,
      automationId,
      automationRunId: runId,
      conversationId: "sub-1",
      text: "NO ATTENTION: Nothing new.",
    });

    expect(store.get(automationId)?.status).toBe("paused");
    expect(store.getRun(runId)).toMatchObject({
      status: "completed",
      resultSummary: "Nothing new.",
    });
    store.close();
  });

  test("recovers a needs-input automation after a successful run", async () => {
    const store = await makeStore();
    const { automationId, runId } = seedRun(store, "needs_input");

    completeAutomationRun({
      automations: store,
      automationId,
      automationRunId: runId,
      conversationId: "sub-1",
      text: "ATTENTION: Fixed after retry.",
    });

    expect(store.get(automationId)?.status).toBe("active");
    expect(store.getRun(runId)?.resultSummary).toBe("Fixed after retry.");
    store.close();
  });

  test("archives one-time reminders after completion", async () => {
    const store = await makeStore();
    const { automationId, runId } = seedRun(store, "active", {
      attentionType: "reminder",
      schedule: buildAutomationSchedule({
        scheduleKind: "once",
        runAt: "2026-05-18T15:30:00.000Z",
      }),
    });

    completeAutomationRun({
      automations: store,
      automationId,
      automationRunId: runId,
      conversationId: "sub-1",
      text: "NO ATTENTION: Done.",
    });

    expect(store.get(automationId)?.status).toBe("archived");
    store.close();
  });
});

async function makeStore(): Promise<SqliteAutomationStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-automation-completion-"));
  return new SqliteAutomationStore(path.join(dir, "state.db"));
}

function seedRun(
  store: SqliteAutomationStore,
  status: AutomationStatus,
  options: { attentionType?: AutomationAttentionType; schedule?: AutomationSchedule } = {},
) {
  const automation = store.create({
    attentionType: options.attentionType ?? "ritual",
    title: "Morning scan",
    prompt: "Check the market.",
    schedule: options.schedule ?? buildAutomationSchedule({ scheduleKind: "daily", time: "08:00" }),
    timezone: "America/Vancouver",
    notificationPolicy: "attention_only",
    originSessionId: "origin",
    createdSource: "chat",
  });
  store.update(automation.id, { status });
  const run = store.createRun({
    automationId: automation.id,
    triggeredAt: "2026-05-16T15:00:00.000Z",
    scheduledFor: "2026-05-16T15:00:00.000Z",
  });
  return { automationId: automation.id, runId: run.id };
}
