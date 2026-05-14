import path from "node:path";
import type { RuntimeServiceRole } from "../protocol/types";
import type { QueueServiceClient } from "../services/queue/client";

const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

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
}

export class RuntimeServiceSupervisor {
  private readonly services: ServiceProcess[] = [];

  constructor(private readonly opts: SupervisorOptions) {
    this.services = opts.services.map((config) => new ServiceProcess(opts.queue, opts.queueUrl, config));
  }

  start(): void {
    for (const service of this.services) service.start();
  }

  async close(): Promise<void> {
    await Promise.all(this.services.map((service) => service.close()));
  }
}

class ServiceProcess {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private closing = false;
  private restartTimer?: Timer;
  private restarts = 0;

  constructor(
    private readonly queue: QueueServiceClient,
    private readonly queueUrl: string,
    private readonly config: ManagedServiceConfig,
  ) {}

  start(): void {
    if (this.config.enabled === false) return;
    if (process.env.AITHY_SERVICE_ROLE === this.config.role) return;
    if (process.env.AITHY_DISABLE_CHILD_SERVICES === "1") return;
    if (this.proc) return;
    this.spawn();
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

  private spawn(): void {
    const entry = path.join(process.cwd(), this.config.entry);
    void sendBestEffort(this.queue.heartbeat(this.config.role, "starting", { entry }));
    void sendBestEffort(this.queue.appendLog({
      role: "web",
      level: "info",
      source: "supervisor",
      message: `starting ${this.config.role}`,
      detail: { entry },
    }));
    const proc = Bun.spawn([process.execPath, "run", entry], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...this.config.env,
        AITHY_SERVICE_ROLE: this.config.role,
        AITHY_QUEUE_URL: this.queueUrl,
      },
    });
    this.proc = proc;
    void captureLines(this.queue, this.config.role, "stdout", proc.stdout);
    void captureLines(this.queue, this.config.role, "stderr", proc.stderr);
    void proc.exited.then((code) => {
      if (this.proc === proc) this.proc = null;
      const level = code === 0 ? "info" : "error";
      void sendBestEffort(this.queue.appendLog({
        role: "web",
        level,
        source: "supervisor",
        message: `${this.config.role} exited with code ${code}`,
      }));
      if (this.closing) return;
      const delayMs = Math.min(30_000, 500 * 2 ** Math.min(this.restarts, 6));
      this.restarts += 1;
      void sendBestEffort(this.queue.heartbeat(
        this.config.role,
        "failed",
        { code, restartInMs: delayMs },
      ));
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined;
        this.spawn();
      }, delayMs);
      this.restartTimer.unref();
    });
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

async function sendBestEffort(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {}
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
