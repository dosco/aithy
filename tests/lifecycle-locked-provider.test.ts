import { describe, expect, test } from "bun:test";
import { LifecycleLockedSandboxProvider } from "../src/sandbox/lifecycle-locked-provider";
import type {
  SandboxBashRequest,
  SandboxBashResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
  SessionMount,
} from "../src/sandbox/provider";

describe("LifecycleLockedSandboxProvider", () => {
  test("lifecycle calls wait for in-flight operations", async () => {
    const inner = new ControlledSandboxProvider();
    const sandbox = new LifecycleLockedSandboxProvider(inner);

    const bash = sandbox.bash("s1", { command: "sleep" });
    await tick();
    expect(inner.events).toEqual(["bash:start"]);

    const park = sandbox.park("s1");
    await tick();
    expect(inner.events).toEqual(["bash:start"]);

    inner.finishBash();
    await bash;
    await tick();
    expect(inner.events).toEqual(["bash:start", "bash:end", "park:start"]);

    inner.finishPark();
    await park;
    expect(inner.events).toEqual(["bash:start", "bash:end", "park:start", "park:end"]);
  });

  test("operations wait while lifecycle calls are active", async () => {
    const inner = new ControlledSandboxProvider();
    const sandbox = new LifecycleLockedSandboxProvider(inner);

    const park = sandbox.park("s1");
    await tick();
    expect(inner.events).toEqual(["park:start"]);

    const bash = sandbox.bash("s1", { command: "after" });
    await tick();
    expect(inner.events).toEqual(["park:start"]);

    inner.finishPark();
    await park;
    await tick();
    expect(inner.events).toEqual(["park:start", "park:end", "bash:start"]);

    inner.finishBash();
    await bash;
  });
});

class ControlledSandboxProvider implements SandboxProvider {
  readonly events: string[] = [];
  private releaseBash?: () => void;
  private releasePark?: () => void;

  async createSession(botId: string, _hostWorkspacePath: string, _mounts: SessionMount[]): Promise<SandboxSession> {
    return { id: `mock-${botId}`, name: `mock-${botId}` };
  }

  async recreate(sessionId: string): Promise<SandboxSession> {
    return { id: sessionId, name: sessionId };
  }

  async bash(_sessionId: string, _request: SandboxBashRequest): Promise<SandboxBashResult> {
    this.events.push("bash:start");
    await new Promise<void>((resolve) => {
      this.releaseBash = resolve;
    });
    this.events.push("bash:end");
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }

  async read(): Promise<string> {
    return "";
  }

  async write(_sessionId: string, path: string, content: string): Promise<SandboxFile> {
    return { path, sizeBytes: content.length };
  }

  async edit(_sessionId: string, path: string, _search: string, replace: string): Promise<SandboxFile> {
    return { path, sizeBytes: replace.length };
  }

  async park(): Promise<void> {
    this.events.push("park:start");
    await new Promise<void>((resolve) => {
      this.releasePark = resolve;
    });
    this.events.push("park:end");
  }

  async resume(): Promise<void> {}

  async destroy(): Promise<void> {}

  finishBash(): void {
    this.releaseBash?.();
  }

  finishPark(): void {
    this.releasePark?.();
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
