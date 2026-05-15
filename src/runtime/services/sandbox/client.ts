import type {
  SandboxBashRequest,
  SandboxBashResult,
  SandboxFile,
  SandboxProvider,
  SandboxSession,
  SessionMount,
} from "../../../sandbox/provider";
import { sendRuntimeCommand } from "../../protocol/command-client";
import type { RuntimeServiceState, SandboxCommand } from "../../protocol/types";
import type { RuntimeStore } from "../../runtime-store";
import type { QueueServiceClient } from "../queue/client";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export class SandboxServiceUnavailableError extends Error {
  constructor(
    public readonly state: RuntimeServiceState | "unknown",
    public readonly detail: unknown,
  ) {
    super(`sandbox-worker is not ready (state=${state})`);
    this.name = "SandboxServiceUnavailableError";
  }
}

export class SandboxCommandClient implements SandboxProvider {
  constructor(private readonly store: RuntimeStore | QueueServiceClient) {}

  async createSession(
    botId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    maybeMounts?: SessionMount[],
  ): Promise<SandboxSession> {
    await this.assertReady();
    const { hostOutboxPath, mounts } = outboxAndMounts(hostWorkspacePath, hostOutboxPathOrMounts, maybeMounts);
    return this.send({
      kind: "sandbox.createSession",
      payload: { botId, hostWorkspacePath, hostOutboxPath, mounts },
      result: { id: "", name: "" },
    });
  }

  async recreate(
    sessionId: string,
    hostWorkspacePath: string,
    hostOutboxPathOrMounts: string | SessionMount[],
    maybeMounts?: SessionMount[],
  ): Promise<SandboxSession> {
    await this.assertReady();
    const { hostOutboxPath, mounts } = outboxAndMounts(hostWorkspacePath, hostOutboxPathOrMounts, maybeMounts);
    return this.send({
      kind: "sandbox.recreate",
      payload: { sessionId, hostWorkspacePath, hostOutboxPath, mounts },
      result: { id: "", name: "" },
    });
  }

  async bash(sessionId: string, request: SandboxBashRequest): Promise<SandboxBashResult> {
    await this.assertReady();
    return this.send({
      kind: "sandbox.bash",
      payload: { sessionId, request },
      result: { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    });
  }

  async read(sessionId: string, path: string, maxBytes?: number): Promise<string> {
    await this.assertReady();
    return this.send({
      kind: "sandbox.read",
      payload: { sessionId, path, maxBytes },
      result: "",
    });
  }

  async write(sessionId: string, path: string, content: string): Promise<SandboxFile> {
    await this.assertReady();
    return this.send({
      kind: "sandbox.write",
      payload: { sessionId, path, content },
      result: { path: "", sizeBytes: 0 },
    });
  }

  async edit(sessionId: string, path: string, search: string, replace: string): Promise<SandboxFile> {
    await this.assertReady();
    return this.send({
      kind: "sandbox.edit",
      payload: { sessionId, path, search, replace },
      result: { path: "", sizeBytes: 0 },
    });
  }

  async park(sessionId: string): Promise<void> {
    await this.assertReady();
    await this.send({
      kind: "sandbox.park",
      payload: { sessionId },
      result: undefined,
    });
  }

  async resume(sessionId: string): Promise<void> {
    await this.assertReady();
    await this.send({
      kind: "sandbox.resume",
      payload: { sessionId },
      result: undefined,
    });
  }

  async destroy(sessionId: string): Promise<void> {
    await this.assertReady();
    await this.send({
      kind: "sandbox.destroy",
      payload: { sessionId },
      result: undefined,
    });
  }

  private async assertReady(): Promise<void> {
    const service = "serviceSync" in this.store
      ? this.store.serviceSync("sandbox-worker") ?? await this.store.service("sandbox-worker")
      : this.store.service("sandbox-worker");
    if (service?.state === "ready" || service?.state === "busy") return;
    throw new SandboxServiceUnavailableError(service?.state ?? "unknown", service?.detail ?? null);
  }

  private send<T extends SandboxCommand>(command: T): Promise<T["result"]> {
    return sendRuntimeCommand(this.store, "sandbox-worker", command, { timeoutMs: DEFAULT_TIMEOUT_MS });
  }
}

function outboxAndMounts(
  hostWorkspacePath: string,
  hostOutboxPathOrMounts: string | SessionMount[],
  maybeMounts?: SessionMount[],
): { hostOutboxPath: string; mounts: SessionMount[] } {
  if (typeof hostOutboxPathOrMounts === "string") {
    return { hostOutboxPath: hostOutboxPathOrMounts, mounts: maybeMounts ?? [] };
  }
  return { hostOutboxPath: `${hostWorkspacePath}/outbox`, mounts: hostOutboxPathOrMounts };
}
