import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { normalizeOrigin, normalizePathValue } from "../../src/security/capability-policy";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { serializablePermissionRequest } from "../../src/web/live-events";
import {
  permissionResponseInput,
  permissionRuleCreateInput,
  permissionRuleDeleteInput,
} from "./action-schemas";

export const respondSystemPermission = createServerFn({ method: "POST" })
  .inputValidator(permissionResponseInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const request = runtime.respondSystemPermission(
      data.requestId,
      data.decision === "allow" ? "allowed" : "denied",
      data.persist,
    );
    return { request: serializablePermissionRequest(request) };
  });

export const createPermissionRule = createServerFn({ method: "POST" })
  .inputValidator(permissionRuleCreateInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    return {
      rule: runtime.runtimeStore.createCapabilityPolicyRule({
        capability: data.capability,
        matchKind: data.matchKind,
        matchValue: normalizeMatchValue(data.matchKind, data.matchValue ?? null),
        source: "settings",
        reason: data.reason ?? "added in settings",
      }),
    };
  });

function normalizeMatchValue(kind: string, value: string | null): string | null {
  if (kind === "global") return null;
  if (!value?.trim()) throw new Error("Permission rule value is required.");
  if (kind === "website_origin") {
    const origin = normalizeOrigin(value);
    if (!origin) throw new Error("Website permission must be an http:// or https:// URL.");
    return origin;
  }
  if (kind === "host_path_exact" || kind === "host_path_prefix" || kind === "cwd_prefix") {
    return normalizePathValue(value);
  }
  return value.trim();
}

export const deletePermissionRule = createServerFn({ method: "POST" })
  .inputValidator(permissionRuleDeleteInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    return { deleted: runtime.runtimeStore.deleteCapabilityPolicyRule(data.id) };
  });

export const resetPermissionRules = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    return { deleted: runtime.runtimeStore.resetCapabilityPolicyRules() };
  });
