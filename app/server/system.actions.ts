import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resetAithyRuntimeSystem } from "../../src/runtime/aithy-runtime.server";
import { ensureHomeSession, HOME_SESSION_ID } from "../../src/session/home-session";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { confirmationInput } from "./action-schemas";
import { webStateDto } from "./dto";

export const resetSystemOptions = createServerFn({ method: "POST" })
  .inputValidator(confirmationInput)
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await resetAithyRuntimeSystem();
    const id = HOME_SESSION_ID;
    ensureHomeSession(runtime.sessions);
    await runtime.sessionState.flush();
    runtime.settings.save({ ui: { lastActiveSessionId: id } });
    return webStateDto(runtime, id);
  });
