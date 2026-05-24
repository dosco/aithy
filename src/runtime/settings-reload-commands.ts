import type { AppConfig } from "../config/env";
import { runtimeSandboxChanged } from "../settings/resolve";
import type { RuntimeServiceRole } from "./protocol/types";

export interface RuntimeReloadCommand {
  role: RuntimeServiceRole;
  kind: string;
}

export function runtimeReloadCommandsForSettingsChange(
  current: AppConfig,
  next: AppConfig,
): RuntimeReloadCommand[] {
  return [
    { role: "agent-worker", kind: "reload_settings" },
    ...(runtimeSandboxChanged(current, next)
      ? [{ role: "sandbox-worker" as const, kind: "sandbox.reload_settings" }]
      : []),
    { role: "local-inference-worker", kind: "local-inference.reload_settings" },
  ];
}
