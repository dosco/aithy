import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/bus";
import { postToSubSessionAndFlush } from "../src/runtime/post-sub-session";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { LiveEventHub } from "../src/web/live-events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

describe("postToSubSessionAndFlush", () => {
  test("flushes before returning the child message id", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-sub-"));
    const sandbox = new MockSandboxProvider();
    const state = new SqliteSessionStateStore(path.join(root, "state.db"));
    const sessions = new SessionManager({
      sandbox,
      botId: "default",
      workspaceRoot: root,
      events: new EventBus(),
      state,
    });
    sessions.ensureLogicalSession("parent");
    let flushed = false;

    const result = await postToSubSessionAndFlush(
      sessions,
      new LiveEventHub(),
      (input) => ({ id: 1, read: false, createdAt: new Date().toISOString(), body: input.body ?? null, link: input.link ?? null, kind: input.kind, title: input.title }),
      { parentSessionId: "parent", text: "child note", notify: false },
      async () => {
        flushed = true;
      },
    );

    expect(flushed).toBe(true);
    expect(result.sessionId).toStartWith("sub-");
    expect(result.messageId).toBe(1);
    state.close();
  });
});
