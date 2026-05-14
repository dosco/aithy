import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { serializablePermissionRequest } from "../../src/web/live-events";
import { permissionResponseInput } from "./action-schemas";

export const respondSystemPermission = createServerFn({ method: "POST" })
  .inputValidator(permissionResponseInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const request = runtime.respondSystemPermission(
      data.requestId,
      data.decision === "allow" ? "allowed" : "denied",
    );
    return { request: serializablePermissionRequest(request) };
  });
