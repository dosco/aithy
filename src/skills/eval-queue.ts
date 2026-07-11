import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SandboxProvider } from "../sandbox/provider";
import type { SessionManager } from "../session/session-manager";
import type { SqliteTaskStore } from "../tasks/task-store";
import { SqliteSkillEvalStore } from "./evals";
import { SkillEvalRunner } from "./eval-runner";
import type { SqliteSkillsStore } from "./skills-store";
import type { SqliteUsageStore } from "../usage/usage-store";

export class SkillEvalQueue {
  private tail = Promise.resolve();
  private readonly store: SqliteSkillEvalStore;
  constructor(private readonly deps: { config: AppConfig; events: EventBus; sessions: SessionManager; sandbox: SandboxProvider;
    skills: SqliteSkillsStore; tasks: SqliteTaskStore; usage?: SqliteUsageStore; runner?: Pick<SkillEvalRunner, "run"> }) { this.store = new SqliteSkillEvalStore(deps.config.stateDbPath); }
  enqueue(skillId: string, taskId: string): void {
    this.tail = this.tail.then(() => this.process(skillId, taskId)).catch(() => {});
  }
  updateConfig(config: AppConfig): void { this.deps.config = config; }
  async close(): Promise<void> { await this.tail; this.store.close(); }
  private async process(skillId: string, taskId: string): Promise<void> {
    this.updateTask(taskId, { status: "running", reason: "Running isolated skill eval cases" });
    const run = this.store.start(skillId, this.deps.config.fastAiModel ?? this.deps.config.aiModel ?? null);
    try {
      const result = await (this.deps.runner ?? new SkillEvalRunner(this.deps)).run(skillId);
      const completed = this.store.complete(run.id, result.cases);
      this.updateTask(taskId, { status: "completed", reason: "Skill eval completed",
        resultSummary: completed.score === null ? "All cases blocked" : `Score ${completed.score.toFixed(2)}`,
        metadata: { skillId, evalRunId: completed.id, score: completed.score } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.fail(run.id, message);
      this.updateTask(taskId, { status: "failed", reason: "Skill eval failed", errorSummary: message,
        metadata: { skillId, evalRunId: run.id } });
    }
  }
  private updateTask(id: string, patch: Parameters<SqliteTaskStore["update"]>[1]): void {
    const task = this.deps.tasks.update(id, patch); if (task) this.deps.events.emit({ type: "task.status", task });
  }
}
