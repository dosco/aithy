import type {
  SandboxBashRequest,
  SandboxBashResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
  SessionMount,
} from "./provider";

export class LifecycleLockedSandboxProvider implements SandboxProvider {
  private activeOperations = 0;
  private lifecycle: Promise<void> = Promise.resolve();
  private readonly idleWaiters: Array<() => void> = [];

  constructor(private readonly inner: SandboxProvider) {}

  createSession(
    botId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    mounts?: SessionMount[],
  ): Promise<SandboxSession> {
    return this.withLifecycle(() => this.inner.createSession(botId, hostWorkspacePath, hostOutboxPathOrMounts, mounts));
  }

  recreate(
    sessionId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    mounts?: SessionMount[],
  ): Promise<SandboxSession> {
    return this.withLifecycle(() => this.inner.recreate(sessionId, hostWorkspacePath, hostOutboxPathOrMounts, mounts));
  }

  bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult> {
    return this.withOperation(() => this.inner.bash(sessionId, request));
  }

  read(sessionId: string, path: string, maxBytes?: number): Promise<string> {
    return this.withOperation(() => this.inner.read(sessionId, path, maxBytes));
  }

  write(sessionId: string, path: string, content: string): Promise<SandboxFile> {
    return this.withOperation(() => this.inner.write(sessionId, path, content));
  }

  edit(sessionId: string, path: string, search: string, replace: string): Promise<SandboxFile> {
    return this.withOperation(() => this.inner.edit(sessionId, path, search, replace));
  }

  park(sessionId: string): Promise<void> {
    return this.withLifecycle(() => this.inner.park(sessionId));
  }

  resume(sessionId: string): Promise<void> {
    return this.withLifecycle(() => this.inner.resume(sessionId));
  }

  destroy(sessionId: string): Promise<void> {
    return this.withLifecycle(() => this.inner.destroy(sessionId));
  }

  private async withOperation<T>(run: () => Promise<T>): Promise<T> {
    await this.lifecycle;
    this.activeOperations += 1;
    try {
      return await run();
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) this.resolveIdleWaiters();
    }
  }

  private withLifecycle<T>(run: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.then(async () => {
      await this.waitForIdle();
      return run();
    });
    this.lifecycle = next.then(() => undefined, () => undefined);
    return next;
  }

  private waitForIdle(): Promise<void> {
    if (this.activeOperations === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private resolveIdleWaiters(): void {
    const waiters = this.idleWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }
}
