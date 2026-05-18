import { buildAutomationSchedule } from "./schedule";
import type { SqliteAutomationStore } from "./store";
import type { AutomationToolActions } from "./tool-actions";
import type { AutomationQueue } from "./queue";

export function createAutomationActions(input: {
  automations: SqliteAutomationStore;
  queue: AutomationQueue;
}): AutomationToolActions {
  const { automations, queue } = input;
  return {
    create: async (request) => {
      const automation = automations.create({
        attentionType: request.attentionType ?? "ritual",
        title: request.title,
        prompt: request.prompt,
        schedule: buildAutomationSchedule(request),
        timezone: request.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        notificationPolicy: request.notificationPolicy ?? defaultNotificationPolicy(request.attentionType ?? "ritual"),
        originSessionId: request.originSessionId,
        createdSource: request.createdSource,
      });
      await queue.syncSchedules();
      return automation;
    },
    list: (originSessionId) => automations.list({ originSessionId }),
    pause: async (id) => {
      const updated = automations.update(id, { status: "paused", nextRunAt: null });
      await queue.syncSchedules();
      return updated;
    },
    resume: async (id) => {
      const updated = automations.update(id, { status: "active" });
      await queue.syncSchedules();
      return updated;
    },
    archive: async (id) => {
      const updated = automations.update(id, { status: "archived", nextRunAt: null });
      await queue.syncSchedules();
      return updated;
    },
    runNow: (id) => queue.runNow(id),
  };
}

function defaultNotificationPolicy(type: NonNullable<Parameters<AutomationToolActions["create"]>[0]["attentionType"]>) {
  return type === "reminder" || type === "briefing" ? "always" : "attention_only";
}
