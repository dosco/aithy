import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { runtimeConsoleDto } from "./runtime-console.dto";

const consoleInput = z.object({
  logLimit: z.number().int().min(20).max(1000).optional(),
  commandLimit: z.number().int().min(20).max(1000).optional(),
}).optional();

export const getRuntimeConsole = createServerFn({ method: "GET" })
  .inputValidator(consoleInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    return runtimeConsoleDto(runtime, data);
  });
