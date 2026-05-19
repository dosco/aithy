import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SessionManager } from "../src/session/session-manager";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { EventBus } from "../src/events/bus";
import { ActiveRunRegistry, type StoppableProgram } from "../src/agent/active-runs";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { HOME_SESSION_ID } from "../src/session/home-session";

async function makeManager(opts: {
  ttlMs?: number;
  idleParkMs?: number;
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-sm-"));
  const sandbox = new MockSandboxProvider();
  const events = new EventBus();
  const sessions = new SessionManager({
    sandbox,
    botId: "default",
    workspaceRoot: path.join(root, "ws"),
    events,
    ttlMs: opts.ttlMs ?? 60_000,
    idleParkMs: opts.idleParkMs ?? 100,
    source: "test",
  });
  return { sessions, sandbox, events };
}

async function makePersistentManager() {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-sm-state-"));
  const sandbox = new MockSandboxProvider();
  const activeRuns = new ActiveRunRegistry();
  const sessions = new SessionManager({
    sandbox,
    botId: "default",
    workspaceRoot: path.join(root, "ws"),
    events: new EventBus(),
    ttlMs: 60_000,
    idleParkMs: 100,
    source: "test",
    activeRuns,
    state: new SqliteSessionStateStore(path.join(root, "state.db")),
  });
  return { sessions, sandbox, activeRuns };
}

describe("SessionManager lifecycle", () => {
  test("two conversations share one bot sandbox VM", async () => {
    const { sessions, sandbox } = await makeManager();
    const a = await sessions.get("conv-a");
    const b = await sessions.get("conv-b");
    expect(a.sandboxSessionId).toBe(b.sandboxSessionId);
    // MockSandboxProvider only sees a single create event for the bot.
    const creates = sandbox.events.filter((e) => e.kind === "create");
    expect(creates).toHaveLength(1);
  });

  test("sweepExpired parks the bot VM only when every session is idle", async () => {
    const { sessions, sandbox } = await makeManager({ idleParkMs: 50 });
    const a = await sessions.get("conv-a");
    const b = await sessions.get("conv-b");
    expect(sandbox.state.get(a.sandboxSessionId)).toBe("live");

    // Only A is idle; the bot VM must stay live because B is fresh.
    a.lastActivityAt = new Date(Date.now() - 10_000);
    await sessions.sweepExpired();
    expect(sandbox.state.get(a.sandboxSessionId)).toBe("live");

    // Now both are idle — bot VM parks.
    b.lastActivityAt = new Date(Date.now() - 10_000);
    await sessions.sweepExpired();
    expect(sandbox.state.get(a.sandboxSessionId)).toBe("parked");
  });

  test("sweepExpired removes expired sessions but leaves the VM alone if other sessions are live", async () => {
    const { sessions, sandbox } = await makeManager({ ttlMs: 50, idleParkMs: 1_000_000 });
    const a = await sessions.get("conv-ttl");
    await sessions.get("conv-fresh");
    a.expiresAt = new Date(Date.now() - 1);

    await sessions.sweepExpired();
    expect(sessions.getSummary("conv-ttl")).toBeUndefined();
    // Bot VM still live for the fresh session.
    expect(sandbox.state.get(a.sandboxSessionId)).toBe("live");
  });

  test("get() resumes the bot VM after sweep parks it", async () => {
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

  test("destroy clears the in-memory session but leaves the bot VM alone", async () => {
    const { sessions, sandbox } = await makeManager();
    const a = await sessions.get("conv-a");
    await sessions.get("conv-b");
    await sessions.destroy("conv-a");
    expect(sessions.getSummary("conv-a")).toBeUndefined();
    // Shared VM still up.
    expect(sandbox.state.get(a.sandboxSessionId)).toBe("live");
  });

  test("emits sandbox starting before created on first conversation", async () => {
    const { sessions, events } = await makeManager();
    const emitted: string[] = [];
    events.subscribe((event) => emitted.push(event.type));

    await sessions.get("conv-starting");

    expect(emitted).toEqual([
      "sandbox.starting",
      "sandbox.created",
    ]);
  });

  test("does not emit sandbox.starting again for the second conversation", async () => {
    const { sessions, events } = await makeManager();
    await sessions.get("conv-1");
    const emitted: string[] = [];
    events.subscribe((event) => emitted.push(event.type));
    await sessions.get("conv-2");
    expect(emitted).toEqual([]);
  });

  test("emits sandbox resuming before created when waking the parked VM", async () => {
    const { sessions, events } = await makeManager({ idleParkMs: 1 });
    const session = await sessions.get("conv-resuming");
    session.lastActivityAt = new Date(Date.now() - 10_000);
    await sessions.sweepExpired();
    const emitted: string[] = [];
    events.subscribe((event) => emitted.push(event.type));

    await sessions.get("conv-resuming");

    expect(emitted).toEqual([
      "sandbox.resuming",
      "sandbox.created",
    ]);
  });

  test("emits sandbox mounts refreshing before refreshed", async () => {
    const { sessions, events } = await makeManager();
    await sessions.get("conv-mount-refresh");
    const emitted: string[] = [];
    events.subscribe((event) => emitted.push(event.type));

    await sessions.refreshMounts("conv-mount-refresh");

    expect(emitted).toEqual([
      "sandbox.mountsRefreshing",
      "sandbox.mountsRefreshed",
    ]);
  });

  test("ensureBotSandbox is single-flight under concurrent get() calls", async () => {
    const { sessions, sandbox } = await makeManager();
    await Promise.all([
      sessions.get("conv-1"),
      sessions.get("conv-2"),
      sessions.get("conv-3"),
    ]);
    const creates = sandbox.events.filter((e) => e.kind === "create");
    expect(creates).toHaveLength(1);
  });

  test("deleteSession stops active run and removes child sessions but keeps the bot VM", async () => {
    const { sessions, sandbox, activeRuns } = await makePersistentManager();
    const active = await sessions.get("parent");
    sessions.createSubSession({ parentSessionId: "parent", name: "child" });
    const stopper = new Stopper();
    activeRuns.register("parent", stopper);

    const deleted = await sessions.deleteSession("parent");

    expect(stopper.stopped).toBe(true);
    expect(deleted).toContain("parent");
    expect(sessions.getSummary("parent")).toBeUndefined();
    expect(sessions.listSessions()).toEqual([]);
    // Bot VM is shared — destroying a conversation does NOT tear it down.
    expect(sandbox.state.get(active.sandboxSessionId)).toBe("live");
  });

  test("listSessions excludes Home even while Home is live", async () => {
    const { sessions } = await makePersistentManager();
    await sessions.get(HOME_SESSION_ID);
    sessions.ensureLogicalSession("specific", { name: "Specific" });

    expect(sessions.listSessions().map((session) => session.conversationId)).toEqual(["specific"]);
  });
});

class Stopper implements StoppableProgram {
  stopped = false;

  stop(): void {
    this.stopped = true;
  }
}
