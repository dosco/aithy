import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { applyRuntimeSettings } from "../src/settings/resolve";
import { runtimeReloadCommandsForSettingsChange } from "../src/runtime/settings-reload-commands";

describe("runtime settings reload commands", () => {
  test("reloads sandbox worker directly when sandbox image changes", () => {
    const base = loadConfig({});
    const next = applyRuntimeSettings(base, {
      sandboxImageSelection: { kind: "internal", id: "aithy-sandbox-lite" },
    });

    expect(runtimeReloadCommandsForSettingsChange(base, next)).toEqual([
      { role: "agent-worker", kind: "reload_settings" },
      { role: "sandbox-worker", kind: "sandbox.reload_settings" },
      { role: "local-inference-worker", kind: "local-inference.reload_settings" },
    ]);
  });

  test("skips sandbox worker for unrelated settings", () => {
    const base = loadConfig({});
    const next = applyRuntimeSettings(base, { parallelAgents: base.parallelAgents + 1 });

    expect(runtimeReloadCommandsForSettingsChange(base, next)).toEqual([
      { role: "agent-worker", kind: "reload_settings" },
      { role: "local-inference-worker", kind: "local-inference.reload_settings" },
    ]);
  });
});
