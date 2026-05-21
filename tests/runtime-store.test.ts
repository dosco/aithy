import { Database } from "bun:sqlite";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { CapabilityBroker } from "../src/security/capability-broker";
import { RuntimeStore } from "../src/runtime/runtime-store";

describe("RuntimeStore", () => {
  test("stores live events and tails them by id", async () => {
    const { store } = await makeStore();
    const first = store.latestEventId();
    const id = store.appendEvent({
      type: "activity",
      id: "event-1",
      conversationId: "c1",
      createdAt: new Date().toISOString(),
      label: "hello",
    });

    expect(id).toBeGreaterThan(first);
    const events = store.eventsAfter(first);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ type: "activity", conversationId: "c1" });
    store.close();
  });

  test("claims commands once and marks completion", async () => {
    const { store, dbPath } = await makeStore();
    const id = store.enqueueCommand("agent-worker", "stop_conversation", { conversationId: "c1" });

    const first = store.claimPendingCommands("agent-worker");
    const second = store.claimPendingCommands("agent-worker");
    expect(first.map((row) => row.id)).toEqual([id]);
    expect(second).toEqual([]);

    store.completeCommand(id, "completed");
    const db = new Database(dbPath, { readonly: true });
    const row = db.query(`SELECT status FROM runtime_commands WHERE id = ?`).get(id) as { status: string };
    expect(row.status).toBe("completed");
    db.close();
    store.close();
  });

  test("stores log events and filters by role", async () => {
    const { store } = await makeStore();
    store.appendLog({ role: "sandbox-worker", level: "info", source: "stdout", message: "vm ready" });
    store.appendLog({ role: "local-inference-worker", level: "warn", message: "model warming" });

    const logs = store.recentEvents({ kinds: ["log"], role: "sandbox-worker" });
    expect(logs).toHaveLength(1);
    expect(logs[0].payload).toMatchObject({ type: "log", role: "sandbox-worker", message: "vm ready" });
    store.close();
  });

  test("prunes expired runtime events from sqlite", async () => {
    const { store, dbPath } = await makeStore();
    const now = new Date("2026-05-12T12:00:00.000Z");
    store.appendEvent({
      type: "activity",
      id: "expired",
      conversationId: "c1",
      createdAt: now.toISOString(),
      label: "expired",
    }, "2026-05-12T11:59:59.000Z");
    store.appendEvent({
      type: "activity",
      id: "live",
      conversationId: "c1",
      createdAt: now.toISOString(),
      label: "live",
    }, "2026-05-12T12:00:01.000Z");

    expect(store.pruneExpiredEvents(now)).toBe(1);
    const db = new Database(dbPath, { readonly: true });
    const row = db.query(`SELECT COUNT(*) AS count FROM runtime_events`).get() as { count: number };
    expect(row.count).toBe(1);
    db.close();
    store.close();
  });

  test("records service heartbeats for split runtime roles", async () => {
    const { store } = await makeStore();
    store.heartbeat("sandbox-worker", "ready", { provider: "disabled" });
    store.heartbeat("local-inference-worker", "starting", { model: "mini" });

    expect(store.service("sandbox-worker")).toMatchObject({ role: "sandbox-worker", state: "ready" });
    expect(store.services().map((service) => service.role)).toContain("local-inference-worker");
    expect(store.recentEvents({ kinds: ["service-status"] })).toHaveLength(2);
    store.close();
  });

  test("can update service heartbeat rows without emitting live events", async () => {
    const { store } = await makeStore();
    store.heartbeat("agent-worker", "ready", { parallelAgents: 3 }, {
      emitEvent: false,
      pid: 1234,
    });

    expect(store.service("agent-worker")).toMatchObject({
      role: "agent-worker",
      state: "ready",
      pid: 1234,
      detail: { parallelAgents: 3 },
    });
    expect(store.recentEvents({ kinds: ["service-status"] })).toHaveLength(0);
    store.close();
  });

  test("waits for typed command completion", async () => {
    const { store } = await makeStore();
    const id = store.enqueueCommand("sandbox-worker", "sandbox.read", { path: "/workspace/a.txt" });
    setTimeout(() => {
      store.claimPendingCommands("sandbox-worker");
      store.completeCommand(id, "completed", { ok: true, result: "hello" });
    }, 10).unref();

    await expect(store.waitForCommand(id, { timeoutMs: 500, pollMs: 5 })).resolves.toEqual({
      ok: true,
      result: "hello",
    });
    store.close();
  });

  test("emits queue status using owner-role protocol", async () => {
    const { store } = await makeStore();
    store.appendQueueStatus({
      id: "agent.chat",
      ownerRole: "agent-worker",
      state: "blocked",
      depth: 1,
      activeCount: 0,
      blockedReason: "waiting for sandbox-worker",
      dependencyRoles: ["sandbox-worker"],
      updatedAt: new Date().toISOString(),
    });

    const [event] = store.recentEvents({ kinds: ["queue-status"] });
    expect(event.payload).toMatchObject({
      type: "queue-status",
      queue: { id: "agent.chat", ownerRole: "agent-worker", state: "blocked" },
    });
    store.close();
  });

  test("capability broker allows sandbox bash and still requires grants for other defaults", async () => {
    const { store, dbPath } = await makeStore();
    const broker = new CapabilityBroker(store);
    broker.require({ capability: "sandbox.bash", toolName: "sandbox.bash", conversationId: "c1" });

    expect(() =>
      broker.require({ capability: "sandbox.edit", toolName: "sandbox.edit", conversationId: "c1" }),
    ).toThrow("Capability denied");

    broker.ensureDefaultLocalGrants();
    broker.require({ capability: "sandbox.edit", toolName: "sandbox.edit", conversationId: "c1" });

    const db = new Database(dbPath, { readonly: true });
    const row = db.query(`SELECT COUNT(*) AS count FROM tool_audit_log`).get() as { count: number };
    expect(row.count).toBe(3);
    db.close();
    store.close();
  });

  test("tracks per-command system permission requests", async () => {
    const { store } = await makeStore();
    const request = store.createPermissionRequest({
      conversationId: "c1",
      capability: "system.bash",
      toolName: "system.bash",
      command: "id",
      cwd: "/tmp",
      reason: "Needs host user identity.",
      argsPreview: "{\"command\":\"id\"}",
    });

    expect(store.pendingPermissionRequests("c1")).toMatchObject([
      { id: request.id, status: "pending", command: "id" },
    ]);
    const allowed = store.decidePermissionRequest(request.id, "allowed", "user allowed once");
    expect(allowed).toMatchObject({
      id: request.id,
      status: "allowed",
      decisionReason: "user allowed once",
    });
    expect(store.pendingPermissionRequests("c1")).toEqual([]);
    store.close();
  });

  test("matches capability policy rules by scope", async () => {
    const { store } = await makeStore();
    expect(store.capabilityPolicyDecision("web.search").allowed).toBe(false);
    store.createCapabilityPolicyRule({
      capability: "web.search",
      matchKind: "global",
      source: "settings",
      reason: "test",
    });
    expect(store.capabilityPolicyDecision("web.search").allowed).toBe(true);

    store.createCapabilityPolicyRule({
      capability: "web.scrape",
      matchKind: "website_origin",
      matchValue: "https://example.com",
      source: "settings",
      reason: "test",
    });
    expect(store.capabilityPolicyDecision("web.scrape", { url: "https://example.com/docs" }).allowed).toBe(true);
    expect(store.capabilityPolicyDecision("web.scrape", { url: "https://elsewhere.test" }).allowed).toBe(false);

    store.createCapabilityPolicyRule({
      capability: "sandbox.mount",
      matchKind: "host_path_prefix",
      matchValue: "/tmp/aithy",
      source: "settings",
      reason: "test",
    });
    expect(store.capabilityPolicyDecision("sandbox.mount", { hostPath: "/tmp/aithy/project" }).allowed).toBe(true);
    expect(store.capabilityPolicyDecision("sandbox.mount", { hostPath: "/tmp/aithy-old" }).allowed).toBe(false);
    store.close();
  });

  test("expires stale pending system permission requests", async () => {
    const { store, dbPath } = await makeStore();
    const request = store.createPermissionRequest({
      conversationId: "c1",
      capability: "system.bash",
      toolName: "system.bash",
      command: "id",
      cwd: "/tmp",
      reason: "Needs host user identity.",
      argsPreview: "{\"command\":\"id\"}",
    });
    const staleCreatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const db = new Database(dbPath);
    db.query(`
      UPDATE permission_requests SET created_at = $createdAt WHERE id = $id
    `).run({ $createdAt: staleCreatedAt, $id: request.id });
    db.close();

    expect(store.pendingPermissionRequests("c1")).toEqual([]);
    expect(store.permissionRequest(request.id)).toMatchObject({
      id: request.id,
      status: "timed_out",
      decisionReason: "permission request expired",
    });
    store.close();
  });
});

async function makeStore(): Promise<{ store: RuntimeStore; dbPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-runtime-store-"));
  const dbPath = path.join(dir, "state.db");
  const store = new RuntimeStore(dbPath);
  return { store, dbPath };
}
