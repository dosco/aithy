import { QueueServiceRuntime } from "./runtime";

const runtime = QueueServiceRuntime.create();
runtime.start();

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log(`[queue-service] received ${signal}, shutting down`);
  const killer = setTimeout(() => process.exit(1), 10_000);
  killer.unref();
  try {
    runtime.stop();
    process.exit(0);
  } catch (error) {
    console.error("[queue-service] shutdown failed:", error);
    process.exit(1);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await new Promise<never>(() => {});
