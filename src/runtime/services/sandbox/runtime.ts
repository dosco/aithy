import { createSandboxProvider } from "../../../sandbox/create-provider";
import { LifecycleLockedSandboxProvider } from "../../../sandbox/lifecycle-locked-provider";
import type {
  SandboxBashRequest,
  SandboxProvider,
  SessionMount,
} from "../../../sandbox/provider";
import { readyStatus, type SetupStatusInput } from "../../../setup/status";
import { EventBus } from "../../../events/bus";
import { LiveEventHub } from "../../../web/live-events";
import { SqliteSettingsStore } from "../../../settings/store";
import { assertSupportedBunVersion } from "../../bun-version";
import { loadBaseConfig, resolveEffectiveConfig } from "../../resolve-effective-config";
import type { AppConfig } from "../../../config/env";
import type { SandboxCommand } from "../../protocol/types";
import type { RuntimeCommandRow } from "../../runtime-store";
import type { QueueServiceClient } from "../queue/client";
import {
  initialSandboxHealth,
  runSandboxDoctor,
  type SandboxHealthReport,
} from "../../../sandbox/health";

type SandboxWorkerConfig = Awaited<ReturnType<typeof resolveEffectiveConfig>>;

export class SandboxWorkerRuntime {
  private heartbeatTimer?: Timer;
  private shutdownPromise?: Promise<void>;
  private activeSessionId: string | null = null;
  private sandboxHealth: SandboxHealthReport;

  private constructor(
    private readonly baseConfig: AppConfig,
    private config: SandboxWorkerConfig,
    private readonly settings: SqliteSettingsStore,
    private readonly queue: QueueServiceClient,
    private readonly events: EventBus,
    private readonly live: LiveEventHub,
    private provider: SandboxProvider,
  ) {
    this.sandboxHealth = initialSandboxHealth(config);
  }

  static async create(queue: QueueServiceClient): Promise<SandboxWorkerRuntime> {
    assertSupportedBunVersion();
    const baseConfig = loadBaseConfig();
    const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
    const config = await resolveEffectiveConfig(baseConfig, settings.load());
    const events = new EventBus();
    const live = new LiveEventHub();
    events.subscribe((event) => live.publishBotEvent(event));
    live.subscribe((event) => void queue.appendEvent(event));
    const setupStatus = setupStatusReporter(events, queue);
    reportSandboxConfig(queue, setupStatus, config);
    const provider = createWorkerProvider(config, setupStatus);
    return new SandboxWorkerRuntime(baseConfig, config, settings, queue, events, live, provider);
  }

  start(): void {
    this.heartbeat("ready", sandboxHeartbeatDetail(this.config, this.sandboxHealth));
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat("ready", sandboxHeartbeatDetail(this.config, this.sandboxHealth));
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
      const result = await this.runCommand(command);
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

  private async runCommand(command: RuntimeCommandRow): Promise<SandboxCommand["result"]> {
    const { kind, payload } = command;
    if (kind === "sandbox.createSession") {
      const value = objectPayload(payload);
      const session = await this.provider.createSession(
        stringField(value, "botId"),
        stringField(value, "hostWorkspacePath"),
        stringField(value, "hostOutboxPath"),
        mountsField(value),
      );
      this.activeSessionId = session.id;
      await this.refreshSandboxHealth(session.id);
      return session;
    }
    if (kind === "sandbox.recreate") {
      const value = objectPayload(payload);
      const session = await this.provider.recreate(
        stringField(value, "sessionId"),
        stringField(value, "hostWorkspacePath"),
        stringField(value, "hostOutboxPath"),
        mountsField(value),
      );
      this.activeSessionId = session.id;
      await this.refreshSandboxHealth(session.id);
      return session;
    }
    if (kind === "sandbox.bash") {
      const value = objectPayload(payload);
      const sessionId = stringField(value, "sessionId");
      const request = bashRequestField(value);
      this.appendLog({
        role: "sandbox-worker",
        level: "info",
        source: "bash",
        message: `bash ${sessionId}`,
        detail: { command: request.command },
      });
      this.sandboxCommandEvent(command.id, sessionId, "started", request);
      try {
        const result = await this.provider.bash(sessionId, request);
        if (result.stdout) this.sandboxCommandEvent(command.id, sessionId, "stdout", request, { chunk: result.stdout });
        if (result.stderr) this.sandboxCommandEvent(command.id, sessionId, "stderr", request, { chunk: result.stderr });
        this.sandboxCommandEvent(command.id, sessionId, result.timedOut ? "timed-out" : result.exitCode === 0 ? "completed" : "failed", request, {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
        });
        return result;
      } catch (error) {
        this.sandboxCommandEvent(command.id, sessionId, "failed", request, {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
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
      const sessionId = stringField(objectPayload(payload), "sessionId");
      await this.provider.destroy(sessionId);
      if (this.activeSessionId === sessionId) this.activeSessionId = null;
      return undefined;
    }
    if (kind === "sandbox.reload_settings") {
      await this.reloadSettings();
      return undefined;
    }
    throw new Error(`Unknown sandbox command: ${kind}`);
  }

  private async reloadSettings(): Promise<void> {
    const next = await resolveEffectiveConfig(this.baseConfig, this.settings.load());
    const setupStatus = setupStatusReporter(this.events, this.queue);
    await this.destroyActiveSandboxForReload();
    this.config = next;
    this.sandboxHealth = initialSandboxHealth(next);
    reportSandboxConfig(this.queue, setupStatus, next);
    this.provider = createWorkerProvider(next, setupStatus);
    this.heartbeat("ready", sandboxHeartbeatDetail(next, this.sandboxHealth));
  }

  private async refreshSandboxHealth(sessionId: string): Promise<void> {
    const startedAt = new Date().toISOString();
    this.sandboxHealth = {
      ...initialSandboxHealth(this.config),
      status: "checking",
      sessionId,
      startedAt,
      checkedAt: startedAt,
    };
    this.heartbeat("busy", sandboxHeartbeatDetail(this.config, this.sandboxHealth));
    const report = await runSandboxDoctor({
      provider: this.provider,
      sessionId,
      config: this.config,
      startedAt,
    });
    this.sandboxHealth = report;
    this.appendLog({
      role: "sandbox-worker",
      level: report.status === "ready" ? "info" : report.status === "degraded" ? "warn" : "error",
      source: "doctor",
      message: `sandbox doctor ${report.status}: ${report.image}`,
      detail: report,
    });
    this.heartbeat("ready", sandboxHeartbeatDetail(this.config, this.sandboxHealth));
  }

  private async destroyActiveSandboxForReload(): Promise<void> {
    if (!this.activeSessionId) return;
    const sessionId = this.activeSessionId;
    this.activeSessionId = null;
    try {
      await this.provider.destroy(sessionId);
      this.appendLog({
        role: "sandbox-worker",
        level: "info",
        source: "config",
        message: `destroyed sandbox ${sessionId} before settings reload`,
      });
    } catch (error) {
      this.appendLog({
        role: "sandbox-worker",
        level: "warn",
        source: "config",
        message: `failed to destroy sandbox ${sessionId} before settings reload: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
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

  private sandboxCommandEvent(
    commandId: string,
    sessionId: string,
    phase: "started" | "stdout" | "stderr" | "completed" | "failed" | "timed-out",
    request: SandboxBashRequest,
    extra: Record<string, unknown> = {},
  ): void {
    void this.queue.appendEvent({
      type: "sandbox-command",
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      commandId,
      sessionId,
      phase,
      command: request.command,
      cwd: request.cwd,
      timeoutProfile: request.timeoutProfile,
      ...extra,
    });
  }
}

function createWorkerProvider(
  config: SandboxWorkerConfig,
  onStatus: (status: SetupStatusInput) => void,
): SandboxProvider {
  return new LifecycleLockedSandboxProvider(createSandboxProvider(config, onStatus));
}

function setupStatusReporter(
  events: EventBus,
  queue: QueueServiceClient,
): (status: SetupStatusInput) => void {
  return (status) => {
    events.emit({ type: "setup.status", status });
    void queue.appendLog({
      role: "sandbox-worker",
      level: status.tone === "danger" ? "error" : "info",
      source: "setup",
      message: status.label,
      detail: status,
    });
  };
}

function reportSandboxConfig(
  queue: QueueServiceClient,
  setupStatus: (status: SetupStatusInput) => void,
  config: SandboxWorkerConfig,
): void {
  setupStatus(readyStatus("sandbox", `sandbox settings loaded: ${config.sandboxImage}`));
  void queue.appendLog({
    role: "sandbox-worker",
    level: "info",
    source: "config",
    message: `sandbox image configured: ${config.sandboxImage}`,
    detail: sandboxHeartbeatDetail(config),
  });
}

function sandboxHeartbeatDetail(config: SandboxWorkerConfig, health?: SandboxHealthReport): Record<string, unknown> {
  return {
    provider: config.sandboxProvider,
    selection: config.sandboxImageSelection,
    label: config.sandboxImageLabel,
    image: config.sandboxImage,
    network: config.sandboxNetwork,
    cpus: config.sandboxCpus,
    memoryMb: config.sandboxMemoryMb,
    health: health ?? initialSandboxHealth(config),
  };
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
    timeoutProfile: optionalTimeoutProfile(record, "timeoutProfile"),
    maxOutputChars: optionalNumber(record, "maxOutputChars"),
    env: optionalStringMap(record, "env"),
  };
}

function optionalTimeoutProfile(value: Record<string, unknown>, key: string): SandboxBashRequest["timeoutProfile"] {
  const field = value[key];
  if (field === undefined) return undefined;
  if (field === "short" || field === "long" || field === "extended") return field;
  throw new Error(`Invalid sandbox command field: ${key}`);
}

function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") throw new Error(`Invalid sandbox command field: ${key}`);
  return field;
}

function optionalStringMap(value: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    throw new Error(`Invalid sandbox command field: ${key}`);
  }
  const out: Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(field)) {
    if (typeof entryValue !== "string") throw new Error(`Invalid sandbox command field: ${key}.${entryKey}`);
    out[entryKey] = entryValue;
  }
  return out;
}
