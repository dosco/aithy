import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { buildAutomationSchedule } from "../../src/automations/schedule";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { messageEvent } from "../../src/web/live-events";
import { automationDto } from "./dto";
import { assistantMessage, publishSessions } from "./action-helpers";

const policy = z.enum(["always", "attention_only", "failures_only", "silent"]);
const attentionType = z.enum(["vigil", "reminder", "ritual", "briefing"]);

const createAutomationInput = z.object({
  attentionType: attentionType.default("ritual"),
  title: z.string().min(1).max(120),
  prompt: z.string().min(1).max(8000),
  scheduleKind: z.string().min(1),
  time: z.string().optional(),
  dayOfWeek: z.string().optional(),
  everyMinutes: z.number().optional(),
  cronPattern: z.string().optional(),
  runAt: z.string().optional(),
  human: z.string().optional(),
  timezone: z.string().optional(),
  notificationPolicy: policy.optional(),
  originSessionId: z.string().optional(),
});

const updateAutomationInput = z.object({
  id: z.string().min(1),
  attentionType: attentionType.optional(),
  title: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(8000).optional(),
  scheduleKind: z.string().min(1).optional(),
  time: z.string().optional(),
  dayOfWeek: z.string().optional(),
  everyMinutes: z.number().optional(),
  cronPattern: z.string().optional(),
  runAt: z.string().optional(),
  human: z.string().optional(),
  timezone: z.string().optional(),
  notificationPolicy: policy.optional(),
});

const idInput = z.object({ id: z.string().min(1) });

export const createAutomation = createServerFn({ method: "POST" })
  .validator(createAutomationInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const originSessionId = data.originSessionId ?? createAutomationParent(runtime, data.title);
    const schedule = buildAutomationSchedule(data);
    const automation = runtime.automations.create({
      attentionType: data.attentionType,
      title: data.title,
      prompt: data.prompt,
      schedule,
      timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      notificationPolicy: data.notificationPolicy ?? defaultPolicy(data.attentionType),
      originSessionId,
      createdSource: "ui",
    });
    appendPromiseMessage(runtime, originSessionId, automation.title, schedule.human);
    await runtime.sessionState.flush();
    publishSessions(runtime);
    await runtime.queue.submitCommand("agent-worker", "automations.sync");
    return { automation: automationDto(automation, runtime.automations) };
  });

export const updateAutomation = createServerFn({ method: "POST" })
  .validator(updateAutomationInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const existing = runtime.automations.get(data.id);
    if (!existing) throw new Error(`Attention not found: ${data.id}`);
    const schedule = data.scheduleKind ? buildAutomationSchedule({
      scheduleKind: data.scheduleKind,
      time: data.time,
      dayOfWeek: data.dayOfWeek,
      everyMinutes: data.everyMinutes,
      cronPattern: data.cronPattern,
      runAt: data.runAt,
      human: data.human,
    }) : undefined;
    const updated = runtime.automations.update(data.id, {
      attentionType: data.attentionType,
      title: data.title,
      prompt: data.prompt,
      schedule,
      timezone: data.timezone,
      notificationPolicy: data.notificationPolicy,
      status: existing.status === "needs_input" ? "active" : existing.status,
    });
    await runtime.queue.submitCommand("agent-worker", "automations.sync");
    return { automation: updated ? automationDto(updated, runtime.automations) : null };
  });

export const pauseAutomation = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const updated = await updateAutomationStatus(runtime, data.id, "paused");
    return { automation: updated ? automationDto(updated, runtime.automations) : null };
  });

export const resumeAutomation = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const updated = await updateAutomationStatus(runtime, data.id, "active");
    return { automation: updated ? automationDto(updated, runtime.automations) : null };
  });

export const archiveAutomation = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const updated = await updateAutomationStatus(runtime, data.id, "archived");
    return { automation: updated ? automationDto(updated, runtime.automations) : null };
  });

export const runAutomationNow = createServerFn({ method: "POST" })
  .validator(idInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const automation = runtime.automations.get(data.id);
    if (!automation || automation.status === "archived") throw new Error(`Attention not runnable: ${data.id}`);
    if (runtime.automations.hasActiveRun(data.id)) throw new Error(`Attention already has a queued or running look: ${data.id}`);
    await runtime.queue.submitCommand("agent-worker", "automation.run_now", { automationId: data.id });
    return { queued: true };
  });

async function updateAutomationStatus(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  id: string,
  status: "active" | "paused" | "archived",
) {
  const updated = runtime.automations.update(id, status === "active" ? { status } : { status, nextRunAt: null });
  await runtime.queue.submitCommand("agent-worker", "automations.sync");
  return updated;
}

function createAutomationParent(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  title: string,
): string {
  const name = `Attention: ${title}`;
  const id = runtime.sessions.uniqueSessionIdForName(name);
  runtime.sessions.ensureLogicalSession(id, { name, nameSource: "manual", source: "automation" });
  return id;
}

function appendPromiseMessage(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  conversationId: string,
  title: string,
  schedule: string,
): void {
  const msg = assistantMessage(`I’ll keep attention on "${title}" on this rhythm: ${schedule}. Future looks will appear here as sub-sessions.`);
  runtime.sessions.appendMessages(conversationId, [msg]);
  runtime.live.publish(messageEvent(conversationId, msg));
}

function defaultPolicy(type: z.infer<typeof attentionType>): z.infer<typeof policy> {
  return type === "reminder" || type === "briefing" ? "always" : "attention_only";
}
