import { createServerFn } from "@tanstack/react-start";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { sessionInput } from "./action-schemas";
import { webStateDto } from "./dto";

export const getWebState = createServerFn({ method: "GET" })
  .inputValidator(sessionInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const activeSessionId = data.conversationId ?? null;
    return webStateDto(runtime, activeSessionId);
  });
