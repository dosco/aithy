import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { automationDto } from "../app/server/dto";
import { automationMigrations } from "../src/automations/migrations";
import { buildAutomationSchedule } from "../src/automations/schedule";
import { SqliteAutomationStore } from "../src/automations/store";

describe("SqliteAutomationStore", () => {
  test("creates automations and records run lifecycle", async () => {
    const store = await makeStore();
    const automation = store.create({
      attentionType: "ritual",
      title: "Morning scan",
      prompt: "Check the market.",
      schedule: buildAutomationSchedule({ scheduleKind: "daily", time: "08:00" }),
      timezone: "America/Vancouver",
      notificationPolicy: "attention_only",
      originSessionId: "origin",
      createdSource: "chat",
    });

    expect(store.active().map((item) => item.id)).toEqual([automation.id]);
    expect(store.get(automation.id)?.attentionType).toBe("ritual");
    expect(automationDto(automation, store).attentionType).toBe("ritual");
    expect(store.update(automation.id, { attentionType: "briefing" })?.attentionType).toBe("briefing");
    const run = store.createRun({
      automationId: automation.id,
      triggeredAt: "2026-05-16T15:00:00.000Z",
      scheduledFor: "2026-05-16T15:00:00.000Z",
    });
    const completed = store.updateRun(run.id, {
      status: "completed",
      runSessionId: "sub-1",
      taskId: "task-1",
      resultSummary: "done",
    });

    expect(completed).toMatchObject({
      status: "completed",
      runSessionId: "sub-1",
      taskId: "task-1",
      completedAt: expect.any(String),
    });
    expect(store.recentRuns(automation.id)).toHaveLength(1);
    expect(store.update(automation.id, { status: "paused", nextRunAt: null })?.status).toBe("paused");
    expect(store.active()).toHaveLength(0);
    store.close();
  });

  test("migrates legacy automation rows to ritual attentions", async () => {
    const dbPath = await legacyDbPath();
    const store = new SqliteAutomationStore(dbPath);
    const legacy = store.get("automation_legacy");

    expect(legacy?.attentionType).toBe("ritual");
    expect(automationDto(legacy!, store)).toMatchObject({
      attentionType: "ritual",
      scheduleKind: "cron",
      scheduleRunAt: null,
    });
    store.close();
  });

  test("builds one-time reminder schedules", () => {
    const schedule = buildAutomationSchedule({
      scheduleKind: "once",
      runAt: "2026-05-18T15:30:00.000Z",
    });

    expect(schedule.kind).toBe("once");
    if (schedule.kind !== "once") throw new Error("expected once schedule");
    expect(schedule.runAt).toBe("2026-05-18T15:30:00.000Z");
    expect(schedule.human).toContain("Once at");
  });
});

async function makeStore(): Promise<SqliteAutomationStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-automation-store-"));
  return new SqliteAutomationStore(path.join(dir, "state.db"));
}

async function legacyDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-automation-legacy-"));
  const dbPath = path.join(dir, "state.db");
  const db = new Database(dbPath, { create: true });
  const now = "2026-05-16T15:00:00.000Z";
  db.exec(`
    CREATE TABLE schema_migrations (
      scope TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (scope, version)
    );
  `);
  db.exec(automationMigrations[0]!.sql);
  db.query(`
    INSERT INTO schema_migrations (scope, version, applied_at)
    VALUES ('automations', 1, $now)
  `).run({ $now: now });
  db.query(`
    INSERT INTO automations (
      id, status, title, prompt, schedule_json, timezone, notification_policy,
      origin_session_id, created_source, created_at, updated_at
    ) VALUES (
      'automation_legacy', 'active', 'Legacy scan', 'Check the market.', $schedule,
      'America/Vancouver', 'attention_only', 'origin', 'chat', $now, $now
    )
  `).run({
    $schedule: JSON.stringify(buildAutomationSchedule({ scheduleKind: "daily", time: "08:00" })),
    $now: now,
  });
  db.close();
  return dbPath;
}
