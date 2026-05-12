import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { runtimeConsoleDto } from "./runtime-console.dto";

const consoleInput = z.object({}).optional();

export const getRuntimeConsole = createServerFn({ method: "GET" })
  .inputValidator(consoleInput)
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return runtimeConsoleDto(runtime);
  });
