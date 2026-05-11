import { createServerFn } from "@tanstack/react-start";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import {
  sessionsPageStateDto,
  setupGateStateDto,
} from "./dto";

export const getSetupGateState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return setupGateStateDto(runtime);
  });

export const getSessionsPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return sessionsPageStateDto(runtime);
  });
