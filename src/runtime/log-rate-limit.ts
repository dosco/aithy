import type { RuntimeLogEventPayload } from "./protocol/types";

const DEFAULT_WINDOW_MS = 5_000;
const MAX_KEYS = 500;

export class RuntimeLogRateLimiter {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs = DEFAULT_WINDOW_MS) {}

  shouldPublish(input: RuntimeLogEventPayload, now = Date.now()): boolean {
    if (input.level === "warn" || input.level === "error") return true;
    const key = logKey(input);
    const lastSeenAt = this.seen.get(key);
    this.seen.set(key, now);
    if (this.seen.size > MAX_KEYS) this.prune(now);
    return lastSeenAt === undefined || now - lastSeenAt >= this.windowMs;
  }

  private prune(now: number): void {
    for (const [key, lastSeenAt] of this.seen) {
      if (now - lastSeenAt >= this.windowMs) this.seen.delete(key);
    }
    if (this.seen.size <= MAX_KEYS) return;
    for (const key of this.seen.keys()) {
      this.seen.delete(key);
      if (this.seen.size <= MAX_KEYS) return;
    }
  }
}

function logKey(input: RuntimeLogEventPayload): string {
  return `${input.role}\0${input.level}\0${input.source ?? ""}\0${input.message}`;
}
