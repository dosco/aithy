export interface LocalInferenceRecoveryDetail {
  restartAttempt: number;
  restartInMs: number;
}

interface TimerRef {
  unref?: () => void;
}

export interface RecoveryScheduler {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => TimerRef;
  clearTimeout: (timer: TimerRef) => void;
}

const INITIAL_RESTART_DELAY_MS = 1_000;
const MAX_RESTART_DELAY_MS = 30_000;

const defaultScheduler: RecoveryScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class LocalInferenceRecovery {
  private attempt = 0;
  private timer: TimerRef | null = null;
  private retryAt: number | null = null;
  private closed = false;

  constructor(private readonly scheduler: RecoveryScheduler = defaultScheduler) {}

  schedule(onRetry: () => void): LocalInferenceRecoveryDetail | null {
    if (this.closed) return null;
    this.cancelPending();
    this.attempt += 1;
    const restartInMs = restartDelayMs(this.attempt);
    this.retryAt = this.scheduler.now() + restartInMs;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      this.retryAt = null;
      if (!this.closed) onRetry();
    }, restartInMs);
    this.timer.unref?.();
    return { restartAttempt: this.attempt, restartInMs };
  }

  runNow<T>(action: () => T): T | undefined {
    if (this.closed) return undefined;
    this.cancelPending();
    return action();
  }

  pendingDetail(): Partial<LocalInferenceRecoveryDetail> {
    if (!this.timer || this.retryAt === null) return {};
    return {
      restartAttempt: this.attempt,
      restartInMs: Math.max(0, this.retryAt - this.scheduler.now()),
    };
  }

  reset(): void {
    this.attempt = 0;
    this.cancelPending();
  }

  cancelPending(): void {
    if (this.timer) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    this.retryAt = null;
  }

  shutdown(): void {
    this.closed = true;
    this.cancelPending();
  }
}

export function restartDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(INITIAL_RESTART_DELAY_MS * 2 ** exponent, MAX_RESTART_DELAY_MS);
}
