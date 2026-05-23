import { createServer } from "node:net";
import { runtimeServiceCommand } from "../service-command";
import { QueueServiceClient } from "../services/queue/client";
import { QueueServiceRuntime } from "../services/queue/runtime";
import { currentRuntimeTopology, type RuntimeTopology } from "../topology";
import { managedServiceEnv } from "./service-env";

const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

export interface QueueServiceHandle {
  url: string;
  token: string;
  client: QueueServiceClient;
  close(): Promise<void>;
}

export async function startQueueService(input: { topology?: RuntimeTopology } = {}): Promise<QueueServiceHandle> {
  const topology = input.topology ?? currentRuntimeTopology();
  if (topology.queuePlacement === "coordinator") return startInProcessQueueService(topology);

  const port = await availablePort();
  const token = crypto.randomUUID();
  const url = `ws://127.0.0.1:${port}/runtime?token=${encodeURIComponent(token)}`;
  const { command } = runtimeServiceCommand({
    role: "queue-service",
    sourceEntry: "src/runtime/services/queue/worker.ts",
    topology,
  });
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: managedServiceEnv({
      AITHY_SERVICE_ROLE: "queue-service",
      AITHY_QUEUE_PORT: String(port),
      AITHY_QUEUE_TOKEN: token,
    }),
  });
  void pipeChildOutput("queue-service", "stdout", proc.stdout);
  void pipeChildOutput("queue-service", "stderr", proc.stderr);
  await waitForHealth(port, token);
  const client = await QueueServiceClient.connect({ url, role: "web", placement: "process" });
  return {
    url,
    token,
    client,
    close: async () => {
      client.close();
      proc.kill("SIGTERM");
      const exited = proc.exited.catch(() => undefined);
      const graceful = await Promise.race([
        exited.then(() => true),
        delay(DEFAULT_SHUTDOWN_GRACE_MS).then(() => false),
      ]);
      if (!graceful) {
        proc.kill("SIGKILL");
        await exited;
      }
    },
  };
}

async function startInProcessQueueService(topology: RuntimeTopology): Promise<QueueServiceHandle> {
  const port = await availablePort();
  const token = crypto.randomUUID();
  const url = `ws://127.0.0.1:${port}/runtime?token=${encodeURIComponent(token)}`;
  const runtime = QueueServiceRuntime.create({
    port,
    token,
    placement: topology.queuePlacement,
  });
  runtime.start();
  const client = await QueueServiceClient.connect({ url, role: "web", placement: topology.queuePlacement });
  return {
    url,
    token,
    client,
    close: async () => {
      client.close();
      runtime.stop();
    },
  };
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not allocate queue-service port"));
      });
    });
  });
}

async function waitForHealth(port: number, token: string): Promise<void> {
  const url = `http://127.0.0.1:${port}/health?token=${encodeURIComponent(token)}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("queue-service did not become ready");
}

async function pipeChildOutput(
  role: string,
  source: "stdout" | "stderr",
  stream: ReadableStream<Uint8Array> | null,
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      if (source === "stderr") console.error(`[${role}] ${line}`);
      else console.log(`[${role}] ${line}`);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
