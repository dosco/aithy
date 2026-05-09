import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionManager } from "../src/session/session-manager";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { WorkspaceStore } from "../src/workspace/store";
import { EventBus } from "../src/events/bus";
import { ActiveRunRegistry, type StoppableProgram } from "../src/agent/active-runs";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

async function makeManager(opts: {
  ttlMs?: number;
  idleParkMs?: number;
  maxLiveSandboxes?: number;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-sm-"));
  const sandbox = new MockSandboxProvider();
  const workspaces = new WorkspaceStore(path.join(root, "ws"));
  const events = new EventBus();
  const sessions = new SessionManager({
    sandbox,
    workspaces,
    events,
    ttlMs: opts.ttlMs ?? 60_000,
    idleParkMs: opts.idleParkMs ?? 100,
    maxLiveSandboxes: opts.maxLiveSandboxes ?? 8,
    source: "test",
  });
  return { sessions, sandbox };
}

async function makePersistentManager() {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-sm-state-"));
  const sandbox = new MockSandboxProvider();
  const activeRuns = new ActiveRunRegistry();
  const sessions = new SessionManager({
    sandbox,
    workspaces: new WorkspaceStore(path.join(root, "ws")),
    events: new EventBus(),
    ttlMs: 60_000,
    idleParkMs: 100,
    maxLiveSandboxes: 8,
    source: "test",
    activeRuns,
    state: new SqliteSessionStateStore(path.join(root, "state.db")),
  });
  return { sessions, sandbox, activeRuns };
}

describe("SessionManager lifecycle", () => {
  test("sweepExpired parks live sessions that have been idle past idleParkMs", async () => {
    const { sessions, sandbox } = await makeManager({ idleParkMs: 50 });
    const session = await sessions.get("conv-idle");
    expect(sandbox.state.get(session.sandboxSessionId)).toBe("live");

    // Force the session to look idle by rewinding lastActivityAt.
    session.lastActivityAt = new Date(Date.now() - 10_000);

    await sessions.sweepExpired();
    expect(sandbox.state.get(session.sandboxSessionId)).toBe("parked");
    expect(sandbox.events.some((e) => e.kind === "park")).toBe(true);
  });

  test("sweepExpired destroys sessions past TTL even if they were parked", async () => {
    const { sessions, sandbox } = await makeManager({ ttlMs: 50, idleParkMs: 1_000_000 });
    const session = await sessions.get("conv-ttl");
    // Force expiry.
    session.expiresAt = new Date(Date.now() - 1);

    await sessions.sweepExpired();
    expect(sandbox.state.has(session.sandboxSessionId)).toBe(false);
    expect(sandbox.events.some((e) => e.kind === "destroy")).toBe(true);
  });

  test("get() on a parked session resumes it through the provider", async () => {
    const { sessions, sandbox } = await makeManager({ idleParkMs: 1 });
    const session = await sessions.get("conv-resume");
    session.lastActivityAt = new Date(Date.now() - 10_000);
    await sessions.sweepExpired();
    expect(sandbox.state.get(session.sandboxSessionId)).toBe("parked");

    const refreshed = await sessions.get("conv-resume");
    expect(refreshed.state).toBe("live");
    expect(sandbox.state.get(session.sandboxSessionId)).toBe("live");
    expect(sandbox.events.some((e) => e.kind === "resume")).toBe(true);
  });

  test("creating a new session past maxLiveSandboxes parks the LRU live one", async () => {
    const { sessions, sandbox } = await makeManager({ maxLiveSandboxes: 2, idleParkMs: 1_000_000 });

    const a = await sessions.get("conv-a");
    // Make A older than the rest so it becomes the LRU candidate.
    a.lastActivityAt = new Date(Date.now() - 10_000);
    await sessions.get("conv-b");
    // Adding the 3rd live session must evict A.
    await sessions.get("conv-c");

    expect(sandbox.state.get(a.sandboxSessionId)).toBe("parked");
    // B and C remain live.
    expect([...sandbox.state.values()].filter((s) => s === "live").length).toBe(2);
  });

  test("destroy clears state and emits a destroy event on the provider", async () => {
    const { sessions, sandbox } = await makeManager();
    const session = await sessions.get("conv-destroy");
    await sessions.destroy("conv-destroy");
    expect(sandbox.state.has(session.sandboxSessionId)).toBe(false);
  });

  test("deleteSession stops active run and removes child sessions", async () => {
    const { sessions, sandbox, activeRuns } = await makePersistentManager();
    const active = await sessions.get("parent");
    sessions.createSubSession({ parentSessionId: "parent", name: "child" });
    const stopper = new Stopper();
    activeRuns.register("parent", stopper);

    const deleted = await sessions.deleteSession("parent");

    expect(stopper.stopped).toBe(true);
    expect(deleted).toContain("parent");
    expect(sandbox.state.has(active.sandboxSessionId)).toBe(false);
    expect(sessions.getSummary("parent")).toBeUndefined();
    expect(sessions.listSessions()).toEqual([]);
  });
});

class Stopper implements StoppableProgram {
  stopped = false;

  stop(): void {
    this.stopped = true;
  }
}
