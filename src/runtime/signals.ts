import type { AithyRuntime } from "./aithy-runtime.server";

const SHUTDOWN_TIMEOUT_MS = 10_000;
let signalsRegistered = false;

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerSignalHandlers(runtime: AithyRuntime): void {
  if (signalsRegistered) return;
  signalsRegistered = true;
  const onSignal = (signal: NodeJS.Signals) => {
    if (runtime.isShuttingDown()) {
      console.error(`[shutdown] received ${signal} during shutdown - forcing exit`);
      process.exit(1);
    }
    console.log(`[shutdown] received ${signal} - gracing for ${SHUTDOWN_TIMEOUT_MS}ms`);
    const killer = setTimeout(() => {
      console.error("[shutdown] timeout - forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    killer.unref();
    runtime
      .shutdown()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("[shutdown] failed:", error);
        process.exit(1);
      });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
