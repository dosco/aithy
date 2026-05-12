import { EmbeddingWorkerRuntime } from "./runtime";
import { connectQueueFromEnv } from "../queue/env";

const queue = await connectQueueFromEnv("embedding-worker");
const runtime = await EmbeddingWorkerRuntime.create(queue);
runtime.start();

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log(`[embedding-worker] received ${signal}, shutting down`);
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
