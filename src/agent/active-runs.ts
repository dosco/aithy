export interface StoppableProgram {
  stop(): void;
}

type IdleCallback = () => void | Promise<void>;

export class ActiveRunRegistry {
  private readonly runs = new Map<string, StoppableProgram>();
  private readonly idleQueues = new Map<string, IdleCallback[]>();

  register(conversationId: string, program: StoppableProgram): void {
    this.runs.set(conversationId, program);
  }

  clear(conversationId: string): void {
    this.runs.delete(conversationId);
    void this.drainIdleQueue(conversationId);
  }

  isActive(conversationId: string): boolean {
    return this.runs.has(conversationId);
  }

  /**
   * Run `fn` immediately if no run is active for this conversation, otherwise
   * queue it to run after the current run's `clear()`. Multiple callbacks are
   * drained sequentially; errors are logged and don't poison the queue.
   */
  onIdle(conversationId: string, fn: IdleCallback): void {
    if (!this.isActive(conversationId)) {
      void this.invokeSafe(fn);
      return;
    }
    const queue = this.idleQueues.get(conversationId) ?? [];
    queue.push(fn);
    this.idleQueues.set(conversationId, queue);
  }

  stop(conversationId: string): boolean {
    const program = this.runs.get(conversationId);
    if (!program) return false;
    program.stop();
    return true;
  }

  cancel(conversationId: string): boolean {
    const stopped = this.stop(conversationId);
    this.runs.delete(conversationId);
    this.idleQueues.delete(conversationId);
    return stopped;
  }

  stopAll(): number {
    let stopped = 0;
    for (const program of this.runs.values()) {
      try {
        program.stop();
        stopped += 1;
      } catch {
        // Best-effort during shutdown.
      }
    }
    this.runs.clear();
    this.idleQueues.clear();
    return stopped;
  }

  private async drainIdleQueue(conversationId: string): Promise<void> {
    const queue = this.idleQueues.get(conversationId);
    if (!queue || queue.length === 0) return;
    this.idleQueues.delete(conversationId);
    for (const fn of queue) {
      await this.invokeSafe(fn);
    }
  }

  private async invokeSafe(fn: IdleCallback): Promise<void> {
    try {
      await fn();
    } catch (error) {
      console.error("[active-runs] onIdle callback failed:", error);
    }
  }
}
