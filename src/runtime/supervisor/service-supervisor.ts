import { runtimeServiceCommand } from "../service-command";
import type { RuntimeServiceRole } from "../protocol/types";
import type { QueueServiceClient } from "../services/queue/client";
import type { RuntimeTopology } from "../topology";
import { managedServiceEnv } from "./service-env";

const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;
const DEFAULT_HEALTHCHECK_INTERVAL_MS = 2_000;
const DEFAULT_HEARTBEAT_STALE_MS = 15_000;
const DEFAULT_STARTUP_GRACE_MS = 15_000;

export interface ManagedServiceConfig {
  role: Exclude<RuntimeServiceRole, "web" | "queue-service">;
  entry: string;
  enabled?: boolean;
  env?: Record<string, string>;
  shutdownGraceMs?: number;
}

interface SupervisorOptions {
  queue: QueueServiceClient;
  queueUrl: string;
  services: ManagedServiceConfig[];
  topology: RuntimeTopology;
  healthCheckIntervalMs?: number;
  heartbeatStaleMs?: number;
  startupGraceMs?: number;
}

export class RuntimeServiceSupervisor {
  private readonly services: ServiceProcess[] = [];
  private healthTimer?: Timer;

  constructor(private readonly opts: SupervisorOptions) {
    this.services = opts.services.map((config) => new ServiceProcess(
      opts.queue,
      opts.queueUrl,
      config,
      opts.topology,
      {
        heartbeatStaleMs: opts.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS,
        startupGraceMs: opts.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS,
      },
    ));
  }

  start(): void {
    for (const service of this.services) service.start();
    this.healthTimer = setInterval(() => {
      void this.checkHealth();
    }, this.opts.healthCheckIntervalMs ?? DEFAULT_HEALTHCHECK_INTERVAL_MS);
    this.healthTimer.unref();
  }

  async checkHealth(): Promise<void> {
    await Promise.all(this.services.map((service) => service.checkHealth()));
  }

  async close(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
    await Promise.all(this.services.map((service) => service.close()));
  }
}

interface ServiceHealthOptions {
  heartbeatStaleMs: number;
  startupGraceMs: number;
}

class ServiceProcess {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private closing = false;
  private restartTimer?: Timer;
  private restarts = 0;
  private startedAt = 0;

  constructor(
    private readonly queue: QueueServiceClient,
    private readonly queueUrl: string,
    private readonly config: ManagedServiceConfig,
    private readonly topology: RuntimeTopology,
    private readonly health: ServiceHealthOptions,
  ) {}

  start(): void {
    if (this.config.enabled === false) return;
    if (process.env.AITHY_SERVICE_ROLE === this.config.role) return;
    if (this.proc) return;
    try {
      this.spawn();
    } catch (error) {
      this.recordStartFailure(error);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const proc = this.proc;
    this.proc = null;
    await sendBestEffort(this.queue.heartbeat(this.config.role, "stopping"));
    if (!proc) return;
    proc.kill("SIGTERM");
    const exited = proc.exited.catch(() => undefined);
    const graceful = await Promise.race([
      exited.then(() => true),
      delay(this.config.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS).then(() => false),
    ]);
    if (!graceful) {
      void sendBestEffort(this.queue.appendLog({
        role: "web",
        level: "warn",
        source: "supervisor",
        message: `${this.config.role} did not stop gracefully; sending SIGKILL`,
      }));
      proc.kill("SIGKILL");
      await exited;
    }
  }

  async checkHealth(now = Date.now()): Promise<void> {
    if (this.config.enabled === false || this.closing || this.restartTimer) return;
    const proc = this.proc;
    if (!proc) return;
    let service: Awaited<ReturnType<QueueServiceClient["service"]>>;
    try {
      service = await this.queue.service(this.config.role);
    } catch (error) {
      void sendBestEffort(this.queue.appendLog({
        role: "web",
        level: "warn",
        source: "supervisor",
        message: `${this.config.role} healthcheck could not read service status: ${errorMessage(error)}`,
      }));
      return;
    }
    const withinStartupGrace = now - this.startedAt < this.health.startupGraceMs;
    const procPid = processId(proc);
    const servicePid = typeof service?.pid === "number" ? service.pid : null;
    const statusBelongsToProc = !procPid || !servicePid || procPid === servicePid;
    if (!statusBelongsToProc && withinStartupGrace) return;
    if (!service) {
      if (!withinStartupGrace) this.restartFromHealthcheck({ reason: "missing heartbeat" });
      return;
    }
    if (service.state === "failed" && statusBelongsToProc) {
      this.restartFromHealthcheck({ reason: "reported failed", detail: service.detail });
      return;
    }
    const lastSeenAt = Date.parse(service.lastSeenAt);
    const stale = !Number.isFinite(lastSeenAt) || now - lastSeenAt > this.health.heartbeatStaleMs;
    if (stale && !withinStartupGrace) {
      this.restartFromHealthcheck({
        reason: "stale heartbeat",
        lastSeenAt: service.lastSeenAt,
      });
    }
  }

  private spawn(): void {
    const { command, entry } = runtimeServiceCommand({
      role: this.config.role,
      sourceEntry: this.config.entry,
      topology: this.topology,
    });
    void sendBestEffort(this.queue.heartbeat(this.config.role, "starting", { entry, placement: "process" }));
    void sendBestEffort(this.queue.appendLog({
      role: "web",
      level: "info",
      source: "supervisor",
      message: `starting ${this.config.role}`,
      detail: { entry },
    }));
    const proc = Bun.spawn(command, {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: managedServiceEnv({
        AITHY_SERVICE_ROLE: this.config.role,
        AITHY_SERVICE_PLACEMENT: "process",
        AITHY_QUEUE_URL: this.queueUrl,
        ...this.config.env,
      }),
    });
    this.proc = proc;
    this.startedAt = Date.now();
    void captureLines(this.queue, this.config.role, "stdout", proc.stdout);
    void captureLines(this.queue, this.config.role, "stderr", proc.stderr);
    void proc.exited.then((code) => {
      const owned = this.proc === proc;
      if (owned) this.proc = null;
      const level = code === 0 ? "info" : "error";
      void sendBestEffort(this.queue.appendLog({
        role: "web",
        level,
        source: "supervisor",
        message: `${this.config.role} exited with code ${code}`,
      }));
      if (this.closing || !owned) return;
      this.scheduleRestart({ code });
    });
  }

  private recordStartFailure(error: unknown): void {
    const message = errorMessage(error);
    void sendBestEffort(this.queue.appendLog({
      role: "web",
      level: "error",
      source: "supervisor",
      message: `${this.config.role} failed to start: ${message}`,
    }));
    if (!this.closing) this.scheduleRestart({ error: message });
  }

  private restartFromHealthcheck(detail: Record<string, unknown>): void {
    if (this.restartTimer) return;
    const proc = this.proc;
    this.proc = null;
    void sendBestEffort(this.queue.appendLog({
      role: "web",
      level: "warn",
      source: "supervisor",
      message: `${this.config.role} failed healthcheck; restarting`,
      detail,
    }));
    proc?.kill("SIGTERM");
    void proc?.exited.catch(() => undefined);
    this.scheduleRestart(detail);
  }

  private scheduleRestart(detail: Record<string, unknown>): void {
    const delayMs = Math.min(30_000, 500 * 2 ** Math.min(this.restarts, 6));
    this.restarts += 1;
    void sendBestEffort(this.queue.heartbeat(
      this.config.role,
      "failed",
      { ...detail, restartInMs: delayMs },
    ));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.start();
    }, delayMs);
    this.restartTimer.unref();
  }
}

async function captureLines(
  queue: QueueServiceClient,
  role: RuntimeServiceRole,
  source: "stdout" | "stderr",
  stream: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) recordLine(queue, role, source, line);
    }
    pending += decoder.decode();
    if (pending.trim()) recordLine(queue, role, source, pending);
  } catch (error) {
    void sendBestEffort(queue.appendLog({
      role: "web",
      level: "warn",
      source: "supervisor",
      message: `failed to capture ${role} ${source}: ${errorMessage(error)}`,
    }));
  }
}

function recordLine(
  queue: QueueServiceClient,
  role: RuntimeServiceRole,
  source: "stdout" | "stderr",
  line: string,
): void {
  const message = line.trimEnd();
  if (!message) return;
  if (source === "stderr") console.error(`[${role}] ${message}`);
  else console.log(`[${role}] ${message}`);
  void sendBestEffort(queue.appendLog({
    role,
    level: source === "stderr" ? "error" : "info",
    source,
    message,
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processId(proc: ReturnType<typeof Bun.spawn>): number | null {
  const pid = (proc as { pid?: unknown }).pid;
  return typeof pid === "number" ? pid : null;
}

async function sendBestEffort(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
