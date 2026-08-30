import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { confirmationInput } from "./action-schemas";
import { memoryRunDto } from "./dto";

export const resetMemories = createServerFn({ method: "POST" })
  .validator(confirmationInput)
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.memory.flushPendingEmbeds();
    await runtime.episodes.flushPendingEmbeds();
    runtime.memory.resetAll();
    runtime.episodes.resetAll();
    runtime.memoryRuns.resetAll();
    return {
      memoriesCount: runtime.memory.count(),
      memoryRuns: runtime.memoryRuns.recent(50).map(memoryRunDto),
    };
  });

export const listMemoryRuns = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return runtime.memoryRuns.recent(50).map(memoryRunDto);
  });

export const runMemoryConsolidate = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.memoryConsolidate.runNow();
    return { queued: true };
  });
