import type { RuntimeServiceRole } from "./protocol/types";

const STORE_BACKOFF_MS = 2_000;
const STORE_LOG_THROTTLE_MS = 5_000;

export class RuntimeStoreGuard {
  private backoffUntil = 0;
  private lastConsoleLogAt = 0;

  constructor(private readonly role: RuntimeServiceRole) {}

  canUseStore(): boolean {
    return Date.now() >= this.backoffUntil;
  }

  run<T>(operation: string, task: () => T): T | undefined {
    if (!this.canUseStore()) return undefined;
    try {
      return task();
    } catch (error) {
      this.noteStoreError(operation, error);
      return undefined;
    }
  }

  noteStoreError(operation: string, error: unknown): void {
    const now = Date.now();
    this.backoffUntil = Math.max(this.backoffUntil, now + STORE_BACKOFF_MS);
    if (now - this.lastConsoleLogAt < STORE_LOG_THROTTLE_MS) return;
    this.lastConsoleLogAt = now;
    console.error(`[${this.role}] runtime store ${operation} failed: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
