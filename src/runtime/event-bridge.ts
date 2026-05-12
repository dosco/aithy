import type { RuntimeStore } from "./runtime-store";
import type { LiveEventHub } from "../web/live-events";

export class RuntimeEventBridge {
  private timer?: Timer;
  private lastId: number;

  constructor(
    private readonly store: RuntimeStore,
    private readonly live: LiveEventHub,
    private readonly intervalMs = 250,
  ) {
    this.lastId = store.latestEventId();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.drain(), this.intervalMs);
    this.timer.unref();
  }

  drain(): void {
    const events = this.store.eventsAfter(this.lastId, 100);
    for (const row of events) {
      this.lastId = row.id;
      this.live.publish(row.payload);
    }
  }

  close(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
