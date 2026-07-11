import { createAiService, createFastAiService } from "../agent/ai-service";
import { createAithyAgent } from "../agent/create-agent";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import { SqliteFeedbackStore } from "../feedback/store";
import type { NotificationCreate } from "../notifications/types";
import type { RuntimeStore } from "../runtime/runtime-store";
import type { SqliteTaskStore } from "../tasks/task-store";
import { PlaybookTooLargeError, ResponderPlaybookCache, ResponderPlaybookStore } from "./store";
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage, usageAttributionForConfig } from "../usage/capture";

const DELAY_MS = 1_500;

export class PlaybookUpdateQueue {
  private readonly timers = new Map<string, { timer: Timer; taskId: string }>();
  private tail = Promise.resolve();
  constructor(private deps: { config: AppConfig; runtimeStore?: RuntimeStore; events: EventBus; tasks: SqliteTaskStore;
    feedback: SqliteFeedbackStore; store: ResponderPlaybookStore; cache: ResponderPlaybookCache; usage?: SqliteUsageStore; notify(input: NotificationCreate): void }) {}
  updateConfig(config: AppConfig): void { this.deps.config = config; }
  enqueue(feedbackId: string, taskId: string): void {
    const existing = this.timers.get(feedbackId);
    if (existing) { clearTimeout(existing.timer); if (existing.taskId !== taskId) this.updateTask(existing.taskId, { status: "cancelled", reason: "Replaced by amended feedback" }); }
    const timer = setTimeout(() => { this.timers.delete(feedbackId); this.tail = this.tail.then(() => this.process(feedbackId, taskId)).catch(() => {}); }, DELAY_MS);
    this.timers.set(feedbackId, { timer, taskId });
  }
  async close(): Promise<void> { for (const item of this.timers.values()) clearTimeout(item.timer); this.timers.clear(); await this.tail; }
  private async process(feedbackId: string, taskId: string): Promise<void> {
    const feedback = this.deps.feedback.get(feedbackId);
    if (!feedback) return void this.updateTask(taskId, { status: "failed", errorSummary: "Feedback not found" });
    this.updateTask(taskId, { status: "running", reason: "Updating responder tone and format playbook" });
    try {
      const { program, llm } = createAithyAgent({ config: this.deps.config, runtimeStore: this.deps.runtimeStore,
        tools: [], events: this.deps.events, conversationId: `playbook-${feedback.id}` });
      if (!program.playbook) throw new Error("Ax responder playbook is unavailable");
      const fast = createFastAiService(this.deps) ?? createAiService(this.deps);
      const handle = program.playbook({ target: "responder", apply: false, studentAI: fast, teacherAI: fast, auto: "light" } as never);
      const snapshot = this.deps.cache.snapshot(); if (snapshot) handle.load(snapshot);
      await handle.update({
        example: { userRequest: feedback.precedingRequest, conversationHistory: JSON.stringify(feedback.history),
          channelContext: { channelId: "feedback", conversationId: feedback.sessionId } } as never,
        prediction: { agentResponse: feedback.assistantResponse },
        feedback: `Verdict: ${feedback.verdict}. Comment: ${feedback.comment ?? "none"}. Learn tone and formatting only. Never change tool policy, permissions, sandboxing, instruction hierarchy, or factual claims.`,
      });
      if (this.deps.usage) captureProgramUsage(program, { store: this.deps.usage, purpose: "playbook.update",
        sessionId: feedback.sessionId, runId: taskId, attribution: usageAttributionForConfig(this.deps.config) });
      this.deps.store.save(handle.getState()); this.deps.cache.refresh();
      this.updateTask(taskId, { status: "completed", reason: "Responder playbook updated", resultSummary: "Tone and format guidance refreshed" });
      void llm;
    } catch (error) {
      if (error instanceof PlaybookTooLargeError) {
        this.deps.cache.reset();
        this.deps.notify({ kind: "info", title: "Responder playbook reset", body: "The learned playbook exceeded 64 KiB and was discarded instead of being partially saved." });
      }
      const message = error instanceof Error ? error.message : String(error);
      this.updateTask(taskId, { status: "failed", reason: "Playbook update failed", errorSummary: message });
    }
  }
  private updateTask(id: string, patch: Parameters<SqliteTaskStore["update"]>[1]): void {
    const task = this.deps.tasks.update(id, patch); if (task) this.deps.events.emit({ type: "task.status", task });
  }
}
