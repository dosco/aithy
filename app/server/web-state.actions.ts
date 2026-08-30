import { createServerFn } from "@tanstack/react-start";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { ensureHomeSession, HOME_SESSION_ID } from "../../src/session/home-session";
import { sessionInput } from "./action-schemas";
import { webStateDto } from "./dto";

export const getWebState = createServerFn({ method: "GET" })
  .validator(sessionInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const activeSessionId = data.conversationId?.trim() || null;
    if (activeSessionId === HOME_SESSION_ID) {
      ensureHomeSession(runtime.sessions);
      await runtime.sessionState.flush();
    }
    return webStateDto(runtime, activeSessionId);
  });
