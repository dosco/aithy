import { describe, expect, test } from "bun:test";
import { createLiveEventBus } from "../app/components/live-events";
import { LiveEventHub, userMessageEvent } from "../src/web/live-events";

describe("web live events", () => {
  test("publishes user messages through the message event shape", () => {
    const event = userMessageEvent(
      "conversation",
      "hello from this tab",
      new Date("2026-04-30T00:00:00Z"),
    );

    expect(event).toMatchObject({
      type: "message",
      conversationId: "conversation",
      message: {
        role: "user",
        content: "hello from this tab",
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    });
  });

  test("delivers user message events to live subscribers", () => {
    const hub = new LiveEventHub();
    const received: unknown[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event));

    hub.publish(userMessageEvent("conversation", "live turn"));
    unsubscribe();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "message",
      conversationId: "conversation",
      message: { role: "user", content: "live turn" },
    });
  });

  test("converts sandbox startup lifecycle events to setup statuses", () => {
    const hub = new LiveEventHub();
    const received: unknown[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event));

    hub.publishBotEvent({ type: "sandbox.starting", conversationId: "conversation" });
    hub.publishBotEvent({
      type: "sandbox.resuming",
      conversationId: "conversation",
      sessionId: "sandbox-1",
    });
    hub.publishBotEvent({
      type: "sandbox.mountsRefreshing",
      conversationId: "conversation",
      sessionId: "sandbox-1",
    });
    unsubscribe();

    expect(received).toHaveLength(3);
    expect(received).toEqual([
      expect.objectContaining({ type: "setup-status", label: "starting sandbox" }),
      expect.objectContaining({ type: "setup-status", label: "resuming sandbox" }),
      expect.objectContaining({ type: "setup-status", label: "refreshing sandbox mounts" }),
    ]);
  });

  test("converts agent tool calls to live message events", () => {
    const hub = new LiveEventHub();
    const received: unknown[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event));

    hub.publishBotEvent({
      type: "agent.tool_call",
      conversationId: "conversation",
      message: {
        role: "assistant",
        kind: "tool_call",
        toolName: "sandbox.bash",
        toolArgs: { command: "pwd" },
        toolResult: { ok: true, value: "/workspace" },
        createdAt: "2026-04-30T00:00:00.000Z",
      },
    });
    unsubscribe();

    expect(received).toEqual([
      expect.objectContaining({
        type: "message",
        conversationId: "conversation",
        message: expect.objectContaining({
          kind: "tool_call",
          toolName: "sandbox.bash",
          toolArgs: { command: "pwd" },
          toolResult: { ok: true, value: "/workspace" },
        }),
      }),
    ]);
  });

  test("replays active setup statuses to late subscribers", () => {
    const hub = new LiveEventHub();
    hub.publishBotEvent({
      type: "setup.status",
      status: {
        key: "sandbox",
        label: "downloading sandbox image python:3.11-slim",
        active: true,
        progress: 0.25,
      },
    });

    const received: unknown[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event));
    unsubscribe();

    expect(received).toEqual([
      expect.objectContaining({
        type: "setup-status",
        key: "sandbox",
        label: "downloading sandbox image python:3.11-slim",
        progress: 0.25,
      }),
    ]);
  });

  test("replays latest service and queue statuses to late subscribers", () => {
    const hub = new LiveEventHub();
    hub.publish({
      type: "service-status",
      id: "svc-1",
      createdAt: "2026-05-13T00:00:00.000Z",
      role: "agent-worker",
      state: "ready",
      pid: 123,
      detail: { parallelAgents: 3 },
      lastSeenAt: "2026-05-13T00:00:00.000Z",
    });
    hub.publish({
      type: "queue-status",
      id: "queue-1",
      createdAt: "2026-05-13T00:00:01.000Z",
      queue: {
        id: "agent.chat",
        ownerRole: "queue-service",
        state: "idle",
        depth: 0,
        activeCount: 0,
        dependencyRoles: ["sandbox-worker"],
        updatedAt: "2026-05-13T00:00:01.000Z",
      },
    });

    const received: unknown[] = [];
    const unsubscribe = hub.subscribe((event) => received.push(event));
    unsubscribe();

    expect(received).toEqual([
      expect.objectContaining({ type: "service-status", role: "agent-worker", state: "ready" }),
      expect.objectContaining({ type: "queue-status", queue: expect.objectContaining({ id: "agent.chat" }) }),
    ]);
  });

  test("client live event bus fans one event out to multiple subscribers", () => {
    const bus = createLiveEventBus();
    const first: unknown[] = [];
    const second: unknown[] = [];
    const unsubscribeFirst = bus.subscribe((event) => first.push(event));
    bus.subscribe((event) => second.push(event));

    bus.publish({ type: "connected", createdAt: "2026-05-13T00:00:00.000Z" });
    unsubscribeFirst();
    bus.publish(userMessageEvent("conversation", "only second sees this"));

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
    expect(bus.listenerCount()).toBe(1);
  });
});
