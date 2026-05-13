import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resetAithyRuntimeSystem } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { confirmationInput } from "./action-schemas";
import { webStateDto } from "./dto";

export const resetSystemOptions = createServerFn({ method: "POST" })
  .inputValidator(confirmationInput)
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await resetAithyRuntimeSystem();
    const id = crypto.randomUUID();
    runtime.sessions.ensureLogicalSession(id);
    await runtime.sessionState.flush();
    runtime.settings.save({ ui: { lastActiveSessionId: id } });
    return webStateDto(runtime, id);
  });
