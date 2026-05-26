import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteNotificationStore } from "../src/notifications/notification-store";

describe("SqliteNotificationStore actionable notifications", () => {
  test("stores action fields and lists active pending actions", async () => {
    const store = await notificationStore();
    try {
      const entry = store.push({
        kind: "session.clarification",
        title: "Aithy has a question",
        body: "Which detail?",
        link: "/chat/session-a",
        conversationId: "session-a",
        actionStatus: "pending",
        actionExpiresAt: "2026-05-27T00:00:00.000Z",
      });

      expect(entry).toMatchObject({
        conversationId: "session-a",
        actionStatus: "pending",
        actionExpiresAt: "2026-05-27T00:00:00.000Z",
        resolvedAt: null,
      });
      expect(store.activeActions()).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("expires stale actions and resolves pending clarification actions by conversation", async () => {
    const store = await notificationStore();
    try {
      store.push({
        kind: "session.clarification",
        title: "Old question",
        conversationId: "session-a",
        actionStatus: "pending",
        actionExpiresAt: "2026-05-01T00:00:00.000Z",
      });
      store.push({
        kind: "session.clarification",
        title: "Fresh question",
        conversationId: "session-b",
        actionStatus: "pending",
        actionExpiresAt: "2026-05-30T00:00:00.000Z",
      });

      expect(store.expireActions(new Date("2026-05-02T00:00:00.000Z"))).toBe(1);
      expect(store.activeActions().map((item) => item.title)).toEqual(["Fresh question"]);
      expect(store.resolvePendingActions({
        conversationId: "session-b",
        kinds: ["session.clarification"],
      })).toBe(1);
      expect(store.activeActions()).toEqual([]);
    } finally {
      store.close();
    }
  });
});

async function notificationStore(): Promise<SqliteNotificationStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-notifications-"));
  return new SqliteNotificationStore(path.join(dir, "state.db"));
}
