import { EmbeddingWorkerRuntime } from "./runtime";
import { connectQueueFromEnv } from "../queue/env";

const queue = await connectQueueFromEnv("embedding-worker");
const runtime = await EmbeddingWorkerRuntime.create(queue);
runtime.start();

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  queue.beginShutdown();
  console.log(`[embedding-worker] shutting down, please wait... received ${signal}`);
  const killer = setTimeout(() => process.exit(1), 10_000);
  killer.unref();
  runtime
    .shutdown()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("[embedding-worker] shutdown failed:", error);
      process.exit(1);
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log("[embedding-worker] booting");
await new Promise<never>(() => {});
