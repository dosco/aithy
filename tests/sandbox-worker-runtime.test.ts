import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/bus";
import type { SandboxProvider } from "../src/sandbox/provider";
import { loadConfig } from "../src/config/env";
import { SqliteSettingsStore } from "../src/settings/store";
import { LiveEventHub } from "../src/web/live-events";
import { SandboxWorkerRuntime } from "../src/runtime/services/sandbox/runtime";

describe("SandboxWorkerRuntime", () => {
  test("destroys the active sandbox before reloading settings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-sandbox-worker-"));
    const destroyed: string[] = [];
    const stateDbPath = path.join(root, "state.db");
    const settings = new SqliteSettingsStore(stateDbPath);
    const queue = fakeQueue();
    const provider = fakeProvider(destroyed);
    const config = {
      ...loadConfig({}),
      stateDir: root,
      stateDbPath,
      workspaceRoot: path.join(root, "workspace"),
      outboxRoot: path.join(root, "outbox"),
      tracesDir: path.join(root, "traces"),
    };
    const runtime = new (SandboxWorkerRuntime as any)(
      config,
      config,
      settings,
      queue,
      new EventBus(),
      new LiveEventHub(),
      provider,
    );

    runtime.activeSessionId = "aithy-default";
    await runtime.reloadSettings();

    expect(destroyed).toEqual(["aithy-default"]);
    expect(runtime.activeSessionId).toBe(null);
    settings.close();
  });
});

function fakeProvider(destroyed: string[]): SandboxProvider {
  return {
    async createSession() { throw new Error("not used"); },
    async recreate() { throw new Error("not used"); },
    async bash() { throw new Error("not used"); },
    async read() { throw new Error("not used"); },
    async write() { throw new Error("not used"); },
    async edit() { throw new Error("not used"); },
    async park() {},
    async resume() {},
    async destroy(sessionId: string) {
      destroyed.push(sessionId);
    },
  };
}

function fakeQueue() {
  return {
    appendLog: async () => undefined,
    appendEvent: async () => undefined,
    heartbeat: async () => undefined,
  };
}
