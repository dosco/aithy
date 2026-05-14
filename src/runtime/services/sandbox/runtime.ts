import { createSandboxProvider } from "../../../sandbox/create-provider";
import { LifecycleLockedSandboxProvider } from "../../../sandbox/lifecycle-locked-provider";
import type {
  SandboxBashRequest,
  SandboxProvider,
  SessionMount,
} from "../../../sandbox/provider";
import type { SetupStatusInput } from "../../../setup/status";
import { EventBus } from "../../../events/bus";
import { LiveEventHub } from "../../../web/live-events";
import { SqliteSettingsStore } from "../../../settings/store";
import { assertSupportedBunVersion } from "../../bun-version";
import { loadBaseConfig, resolveEffectiveConfig } from "../../resolve-effective-config";
import type { SandboxCommand } from "../../protocol/types";
import type { RuntimeCommandRow } from "../../runtime-store";
import type { QueueServiceClient } from "../queue/client";

export class SandboxWorkerRuntime {
  private heartbeatTimer?: Timer;
  private shutdownPromise?: Promise<void>;

  private constructor(
    private config: Awaited<ReturnType<typeof resolveEffectiveConfig>>,
    private readonly settings: SqliteSettingsStore,
    private readonly queue: QueueServiceClient,
    private readonly events: EventBus,
    private readonly live: LiveEventHub,
    private provider: SandboxProvider,
  ) {}

  static async create(queue: QueueServiceClient): Promise<SandboxWorkerRuntime> {
    assertSupportedBunVersion();
    const baseConfig = loadBaseConfig();
    const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
    const config = await resolveEffectiveConfig(baseConfig, settings.load());
    const events = new EventBus();
    const live = new LiveEventHub();
    events.subscribe((event) => live.publishBotEvent(event));
    live.subscribe((event) => void queue.appendEvent(event));
    const setupStatus = (status: SetupStatusInput) => {
      events.emit({ type: "setup.status", status });
      void queue.appendLog({
        role: "sandbox-worker",
        level: status.tone === "danger" ? "error" : "info",
        source: "setup",
        message: status.label,
        detail: status,
      });
    };
    const provider = createWorkerProvider(config, setupStatus);
    return new SandboxWorkerRuntime(config, settings, queue, events, live, provider);
  }

  start(): void {
    this.heartbeat("ready", { provider: this.config.sandboxProvider });
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat("ready", { provider: this.config.sandboxProvider });
    }, 2_000);
    this.heartbeatTimer.unref();
    this.queue.onCommand((command) => this.handleCommand(command));
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.doShutdown();
    return this.shutdownPromise;
  }

  private async handleCommand(command: RuntimeCommandRow): Promise<unknown> {
    this.appendLog({
      role: "sandbox-worker",
      level: "debug",
      source: "command",
      message: `start ${command.kind}`,
      detail: { commandId: command.id },
    });
    try {
      const result = await this.runCommand(command.kind, command.payload);
      this.appendLog({
        role: "sandbox-worker",
        level: "debug",
        source: "command",
        message: `complete ${command.kind}`,
        detail: { commandId: command.id },
      });
      return result;
    } catch (error) {
      this.appendLog({
        role: "sandbox-worker",
        level: "error",
        source: "command",
        message: `failed ${command.kind}: ${error instanceof Error ? error.message : String(error)}`,
        detail: { commandId: command.id },
      });
      throw error;
    }
  }

  private async runCommand(kind: string, payload: unknown): Promise<SandboxCommand["result"]> {
    if (kind === "sandbox.createSession") {
      const value = objectPayload(payload);
      return this.provider.createSession(
        stringField(value, "botId"),
        stringField(value, "hostWorkspacePath"),
        mountsField(value),
      );
    }
    if (kind === "sandbox.recreate") {
      const value = objectPayload(payload);
      return this.provider.recreate(
        stringField(value, "sessionId"),
        stringField(value, "hostWorkspacePath"),
        mountsField(value),
      );
    }
    if (kind === "sandbox.bash") {
      const value = objectPayload(payload);
      this.appendLog({
        role: "sandbox-worker",
        level: "info",
        source: "bash",
        message: `bash ${stringField(value, "sessionId")}`,
        detail: { command: bashRequestField(value).command },
      });
      return this.provider.bash(stringField(value, "sessionId"), bashRequestField(value));
    }
    if (kind === "sandbox.read") {
      const value = objectPayload(payload);
      return this.provider.read(stringField(value, "sessionId"), stringField(value, "path"), optionalNumber(value, "maxBytes"));
    }
    if (kind === "sandbox.write") {
      const value = objectPayload(payload);
      return this.provider.write(stringField(value, "sessionId"), stringField(value, "path"), stringField(value, "content"));
    }
    if (kind === "sandbox.edit") {
      const value = objectPayload(payload);
      return this.provider.edit(
        stringField(value, "sessionId"),
        stringField(value, "path"),
        stringField(value, "search"),
        stringField(value, "replace"),
      );
    }
    if (kind === "sandbox.park") {
      await this.provider.park(stringField(objectPayload(payload), "sessionId"));
      return undefined;
    }
    if (kind === "sandbox.resume") {
      await this.provider.resume(stringField(objectPayload(payload), "sessionId"));
      return undefined;
    }
    if (kind === "sandbox.destroy") {
      await this.provider.destroy(stringField(objectPayload(payload), "sessionId"));
      return undefined;
    }
    if (kind === "sandbox.reload_settings") {
      await this.reloadSettings();
      return undefined;
    }
    throw new Error(`Unknown sandbox command: ${kind}`);
  }

  private async reloadSettings(): Promise<void> {
    const next = await resolveEffectiveConfig(loadBaseConfig(), this.settings.load());
    this.config = next;
    this.provider = createWorkerProvider(next, (status) => this.events.emit({ type: "setup.status", status }));
    this.heartbeat("ready", { provider: next.sandboxProvider });
  }

  private async doShutdown(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.queue.beginShutdown();
    this.heartbeat("stopping");
    this.settings.close();
    this.queue.close();
  }

  private appendLog(input: Parameters<QueueServiceClient["appendLog"]>[0]): void {
    void this.queue.appendLog(input);
  }

  private heartbeat(state: Parameters<QueueServiceClient["heartbeat"]>[1], detail?: unknown): void {
    void this.queue.heartbeat("sandbox-worker", state, detail);
  }
}

function createWorkerProvider(
  config: Awaited<ReturnType<typeof resolveEffectiveConfig>>,
  onStatus: (status: SetupStatusInput) => void,
): SandboxProvider {
  return new LifecycleLockedSandboxProvider(createSandboxProvider(config, onStatus));
}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new Error("Invalid sandbox command payload");
  return payload as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Invalid sandbox command field: ${key}`);
  return field;
}

function optionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "number") throw new Error(`Invalid sandbox command field: ${key}`);
  return field;
}

function mountsField(value: Record<string, unknown>): SessionMount[] {
  const mounts = value.mounts;
  if (!Array.isArray(mounts)) throw new Error("Invalid sandbox mounts");
  return mounts.map((mount) => {
    if (!mount || typeof mount !== "object") throw new Error("Invalid sandbox mount");
    const record = mount as Record<string, unknown>;
    return {
      hostPath: stringField(record, "hostPath"),
      mountName: stringField(record, "mountName"),
    };
  });
}

function bashRequestField(value: Record<string, unknown>): SandboxBashRequest {
  const request = value.request;
  if (!request || typeof request !== "object") throw new Error("Invalid sandbox bash request");
  const record = request as Record<string, unknown>;
  return {
    command: stringField(record, "command"),
    cwd: optionalString(record, "cwd"),
    timeoutMs: optionalNumber(record, "timeoutMs"),
    maxOutputChars: optionalNumber(record, "maxOutputChars"),
  };
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") throw new Error(`Invalid sandbox command field: ${key}`);
  return field;
}
