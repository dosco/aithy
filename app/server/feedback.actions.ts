import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { SqliteFeedbackStore } from "../../src/feedback/store";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { ResponderPlaybookStore } from "../../src/playbook/store";

const feedbackInput = z.object({ sessionId: z.string().min(1).max(200), messageId: z.number().int().positive(),
  verdict: z.enum(["up", "down"]), comment: z.string().max(4_000).optional().nullable() });

export const saveChatFeedback = createServerFn({ method: "POST" }).validator(feedbackInput).handler(async ({ data }) => {
  assertLoopbackRequest(getRequest());
  const runtime = await getAithyRuntime();
  const store = new SqliteFeedbackStore(runtime.config.stateDbPath);
  let feedback;
  try { feedback = store.upsert(data); } finally { store.close(); }
  let taskId: string | null = null;
  if (runtime.settings.load().runtime.playbookLearningEnabled === true) {
    const planned = runtime.tasks.createOrReusePlanned({ dedupeKey: `playbook:${feedback.id}`, create: {
      kind: "playbook.update", title: "Learn from chat feedback", conversationId: data.sessionId,
      relatedSessionId: data.sessionId, reason: "Queued for responder tone and format learning", metadata: { feedbackId: feedback.id },
    }, update: { reason: "Queued from amended chat feedback", metadata: { feedbackId: feedback.id } } });
    taskId = planned.task.id; runtime.events.emit({ type: "task.status", task: planned.task });
    const commandId = await runtime.queue.submitCommand("agent-worker", "playbook.update", { feedbackId: feedback.id, taskId });
    runtime.tasks.update(taskId, { runtimeCommandId: commandId });
  }
  return { feedback: { id: feedback.id, verdict: feedback.verdict, comment: feedback.comment }, taskId };
});

export const resetResponderPlaybook = createServerFn({ method: "POST" }).handler(async () => {
  assertLoopbackRequest(getRequest());
  const runtime = await getAithyRuntime();
  const store = new ResponderPlaybookStore(runtime.config.stateDbPath); store.reset(); store.close();
  await runtime.queue.invokeCommand("agent-worker", "playbook.reset");
  return { reset: true };
});
