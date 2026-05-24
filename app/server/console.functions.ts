import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { runtimeConsoleDto, staleRuntimeConsoleDto } from "./runtime-console.dto";

const consoleInput = z.object({
  logLimit: z.number().int().min(20).max(1000).optional(),
  commandLimit: z.number().int().min(20).max(1000).optional(),
}).optional();

export const getRuntimeConsole = createServerFn({ method: "GET" })
  .inputValidator(consoleInput)
  .handler(async ({ data }) => {
    try {
      const runtime = await getAithyRuntime();
      return await runtimeConsoleDto(runtime, data);
    } catch (error) {
      return staleRuntimeConsoleDto(error, data);
    }
  });

export const retrySandboxSetup = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.queue.appendEvent({
      type: "setup-status",
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      key: "sandbox",
      label: "retrying sandbox setup",
      active: true,
      tone: "neutral",
    });
    await runtime.queue.submitCommand("sandbox-worker", "sandbox.reload_settings");
    return runtimeConsoleDto(runtime);
  });
