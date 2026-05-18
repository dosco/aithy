import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { shutdownManager } from "bunqueue/client";
import { AutomationQueue } from "../src/automations/queue";
import { buildAutomationSchedule } from "../src/automations/schedule";
import { SqliteAutomationStore } from "../src/automations/store";
import type { AppConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { SqliteTaskStore } from "../src/tasks/task-store";
import type { TaskRecord } from "../src/tasks/types";

const queues: AutomationQueue[] = [];

afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.close().catch(() => {});
  try {
    shutdownManager();
  } catch {}
});

describe("AutomationQueue", () => {
  test("scheduled wake creates a child session, task, and normal chat job", async () => {
    const fx = await fixture();
    fx.sessions.ensureLogicalSession("origin", { name: "Origin" });
    const automation = fx.automations.create({
      attentionType: "ritual",
      title: "Morning scan",
      prompt: "Check the latest release notes.",
      schedule: buildAutomationSchedule({ scheduleKind: "daily", time: "08:00" }),
      timezone: "America/Vancouver",
      notificationPolicy: "attention_only",
      originSessionId: "origin",
      createdSource: "chat",
    });

    const queue = makeQueue(fx);
    await (queue as unknown as {
      processJob(job: { id: string; timestamp: number; data: { automationId: string; triggeredAt: string; scheduledFor: string } }): Promise<unknown>;
    }).processJob({
      id: "job-1",
      timestamp: Date.now(),
      data: {
        automationId: automation.id,
        triggeredAt: "2026-05-16T15:00:00.000Z",
        scheduledFor: "2026-05-16T15:00:00.000Z",
      },
    });

    expect(fx.jobs).toHaveLength(1);
    expect(fx.jobs[0]).toMatchObject({
      skillIds: [],
      automationId: automation.id,
      automationRunId: expect.any(String),
      taskId: expect.any(String),
    });
    const child = fx.sessions.listChildSessions("origin")[0];
    expect(child).toBeTruthy();
    expect(fx.jobs[0].conversationId).toBe(child.conversationId);
    expect(fx.sessions.getTranscript(child.conversationId)[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("Scheduled attention look: Morning scan"),
    });
    expect(fx.tasks[0]).toMatchObject({
      kind: "chat.turn",
      relatedSessionId: child.conversationId,
    });
    expect(fx.publishedSessions).toBeGreaterThan(0);
    fx.close();
  });

  test("manual wake can run a paused automation", async () => {
    const fx = await fixture();
    fx.sessions.ensureLogicalSession("origin", { name: "Origin" });
    const automation = fx.automations.create({
      attentionType: "ritual",
      title: "Paused scan",
      prompt: "Check once now.",
      schedule: buildAutomationSchedule({ scheduleKind: "daily", time: "08:00" }),
      timezone: "America/Vancouver",
      notificationPolicy: "attention_only",
      originSessionId: "origin",
      createdSource: "ui",
    });
    fx.automations.update(automation.id, { status: "paused" });

    const queue = makeQueue(fx);
    await (queue as unknown as {
      processJob(job: {
        id: string;
        timestamp: number;
        data: { automationId: string; triggeredAt: string; scheduledFor: string; manual?: boolean };
      }): Promise<unknown>;
    }).processJob({
      id: "job-1",
      timestamp: Date.now(),
      data: {
        automationId: automation.id,
        triggeredAt: "2026-05-16T15:00:00.000Z",
        scheduledFor: "2026-05-16T15:00:00.000Z",
        manual: true,
      },
    });

    expect(fx.jobs).toHaveLength(1);
    expect(fx.jobs[0]).toMatchObject({ automationId: automation.id });
    fx.close();
  });

  test("one-time reminders clear their next look after waking", async () => {
    const fx = await fixture();
    fx.sessions.ensureLogicalSession("origin", { name: "Origin" });
    const automation = fx.automations.create({
      attentionType: "reminder",
      title: "Passport reminder",
      prompt: "Remind me to renew my passport.",
      schedule: buildAutomationSchedule({
        scheduleKind: "once",
        runAt: "2026-05-18T15:30:00.000Z",
      }),
      timezone: "America/Vancouver",
      notificationPolicy: "always",
      originSessionId: "origin",
      createdSource: "ui",
    });
    fx.automations.update(automation.id, { nextRunAt: "2026-05-18T15:30:00.000Z" });

    const queue = makeQueue(fx);
    await (queue as unknown as {
      processJob(job: { id: string; timestamp: number; data: { automationId: string; triggeredAt: string; scheduledFor: string } }): Promise<unknown>;
    }).processJob({
      id: "job-1",
      timestamp: Date.now(),
      data: {
        automationId: automation.id,
        triggeredAt: "2026-05-18T15:30:00.000Z",
        scheduledFor: "2026-05-18T15:30:00.000Z",
      },
    });

    expect(fx.jobs).toHaveLength(1);
    expect(fx.automations.get(automation.id)?.nextRunAt).toBeNull();
    fx.close();
  });
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-automation-queue-"));
  const stateDbPath = path.join(dir, "state.db");
  const state = new SqliteSessionStateStore(stateDbPath);
  const sessions = new SessionManager({
    sandbox: new MockSandboxProvider(),
    botId: "default",
    workspaceRoot: dir,
    events: new EventBus(),
    state,
  });
  const automations = new SqliteAutomationStore(stateDbPath);
  const taskStore = new SqliteTaskStore(stateDbPath);
  const tasks: TaskRecord[] = [];
  const jobs: any[] = [];
  return {
    stateDbPath,
    sessions,
    automations,
    taskStore,
    tasks,
    jobs,
    publishedSessions: 0,
    close: () => {
      state.close();
      automations.close();
      taskStore.close();
    },
  };
}

function makeQueue(fx: Awaited<ReturnType<typeof fixture>>): AutomationQueue {
  const queue = new AutomationQueue({
    config: { stateDbPath: fx.stateDbPath } as AppConfig,
    automations: fx.automations,
    sessions: fx.sessions,
    tasks: fx.taskStore,
    enqueueUserChat: async (data) => {
      fx.jobs.push(data);
      return { jobId: `job-${fx.jobs.length}`, conversationId: data.conversationId };
    },
    onTaskStatus: (task) => fx.tasks.push(task),
    publishSessions: () => {
      fx.publishedSessions += 1;
    },
  });
  queues.push(queue);
  return queue;
}
