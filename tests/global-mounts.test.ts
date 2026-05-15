import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/config/env";
import { ActiveRunRegistry } from "../src/agent/active-runs";
import { globalMountsChanged } from "../src/settings/resolve";
import {
  computeMountName,
  SessionManager,
} from "../src/session/session-manager";
import { EventBus } from "../src/events/bus";
import type { SandboxProvider, SessionMount } from "../src/sandbox/provider";

function configFixture(globalMounts: AppConfig["globalMounts"] = []): AppConfig {
  return {
    aiProvider: "openai",
    sandboxProvider: "disabled",
    sandboxImage: "x",
    sandboxCpus: 1,
    sandboxMemoryMb: 1,
    sandboxNetwork: "none",
    sessionTtlMs: 1,
    idleParkMs: 1,
    parallelAgents: 1,
    parallelSearchMcpUrl: "https://search.parallel.ai/mcp",
    workspaceRoot: "/tmp",
    outboxRoot: "/tmp/outbox",
    botId: "default",
    stateDir: "/tmp",
    stateDbPath: "/tmp/x.db",
    systemBashEnabled: true,
    traceEnabled: false,
    tracesDir: "/tmp/traces",
    globalMounts,
  };
}

describe("globalMountsChanged", () => {
  test("returns false for identical paths regardless of order", () => {
    const a = configFixture([{ hostPath: "/x" }, { hostPath: "/y" }]);
    const b = configFixture([{ hostPath: "/y" }, { hostPath: "/x" }]);
    expect(globalMountsChanged(a, b)).toBe(false);
  });

  test("detects added paths", () => {
    const a = configFixture([{ hostPath: "/x" }]);
    const b = configFixture([{ hostPath: "/x" }, { hostPath: "/y" }]);
    expect(globalMountsChanged(a, b)).toBe(true);
  });

  test("detects removed paths", () => {
    const a = configFixture([{ hostPath: "/x" }, { hostPath: "/y" }]);
    const b = configFixture([{ hostPath: "/x" }]);
    expect(globalMountsChanged(a, b)).toBe(true);
  });

  test("treats undefined and empty arrays as equal", () => {
    const a = configFixture();
    const b = { ...configFixture(), globalMounts: undefined as unknown as AppConfig["globalMounts"] };
    expect(globalMountsChanged(a, b)).toBe(false);
  });
});

describe("ActiveRunRegistry.onIdle", () => {
  test("fires immediately when no run is active", async () => {
    const reg = new ActiveRunRegistry();
    let fired = false;
    reg.onIdle("c1", () => { fired = true; });
    await Promise.resolve();
    expect(fired).toBe(true);
  });

  test("queues until clear() then drains in order", async () => {
    const reg = new ActiveRunRegistry();
    reg.register("c1", { stop: () => {} });
    const order: number[] = [];
    reg.onIdle("c1", async () => { order.push(1); });
    reg.onIdle("c1", async () => { order.push(2); });
    expect(reg.isActive("c1")).toBe(true);
    expect(order).toEqual([]);
    reg.clear("c1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([1, 2]);
    expect(reg.isActive("c1")).toBe(false);
  });

  test("an erroring callback does not block subsequent callbacks", async () => {
    const reg = new ActiveRunRegistry();
    reg.register("c1", { stop: () => {} });
    const order: number[] = [];
    reg.onIdle("c1", () => { throw new Error("boom"); });
    reg.onIdle("c1", () => { order.push(2); });
    reg.clear("c1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual([2]);
  });
});

describe("SessionManager.mountsForSandbox", () => {
  test("filters out paths that don't exist on disk and dedups", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "axbot-mounts-"));
    const present = path.join(tmp, "real");
    await writeFile(present, "");
    const missing = "/this/path/should/not/exist/anywhere";

    const sandbox: SandboxProvider = {
      createSession: async () => ({ id: "x", name: "x" }),
      recreate: async () => ({ id: "x", name: "x" }),
      bash: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
      read: async () => "",
      write: async () => ({ path: "", sizeBytes: 0 }),
      edit: async () => ({ path: "", sizeBytes: 0 }),
      park: async () => undefined,
      resume: async () => undefined,
      destroy: async () => undefined,
    };

    const mgr = new SessionManager({
      sandbox,
      botId: "default",
      workspaceRoot: tmp,
      events: new EventBus(),
      globalMounts: [
        { hostPath: present },
        { hostPath: present },
        { hostPath: missing },
      ],
    });
    const mounts: SessionMount[] = mgr.mountsForSandbox();
    expect(mounts).toEqual([
      { hostPath: present, mountName: computeMountName(present) },
    ]);
  });
});

describe("SessionManager.addGlobalMount", () => {
  test("idempotent on existing host paths and persists via callback", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "axbot-add-"));
    const folder = path.join(tmp, "vault");
    await writeFile(path.join(tmp, "vault"), "").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(folder, { recursive: true });
    });

    const sandbox: SandboxProvider = {
      createSession: async () => ({ id: "x", name: "x" }),
      recreate: async () => ({ id: "x", name: "x" }),
      bash: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
      read: async () => "",
      write: async () => ({ path: "", sizeBytes: 0 }),
      edit: async () => ({ path: "", sizeBytes: 0 }),
      park: async () => undefined,
      resume: async () => undefined,
      destroy: async () => undefined,
    };

    const persisted: Array<Array<{ hostPath: string }>> = [];
    const mgr = new SessionManager({
      sandbox,
      botId: "default",
      workspaceRoot: tmp,
      events: new EventBus(),
      persistGlobalMounts: (mounts) => persisted.push(mounts),
    });

    const r1 = await mgr.addGlobalMount(folder);
    expect(r1.alreadyExisted).toBe(false);
    expect(r1.sandboxPath).toBe(`/mounts/${computeMountName(folder)}`);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual([{ hostPath: folder }]);

    const r2 = await mgr.addGlobalMount(folder);
    expect(r2.alreadyExisted).toBe(true);
    expect(persisted).toHaveLength(1);
  });
});
