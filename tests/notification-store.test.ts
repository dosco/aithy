import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteNotificationStore } from "../src/notifications/notification-store";

describe("SqliteNotificationStore actionable notifications", () => {
  test("stores action fields and lists active pending actions", async () => {
    const store = await notificationStore();
    try {
      const actionExpiresAt = daysFromNow(30);
      const entry = store.push({
        kind: "session.clarification",
        title: "Aithy has a question",
        body: "Which detail?",
        link: "/chat/session-a",
        conversationId: "session-a",
        actionStatus: "pending",
        actionExpiresAt,
      });

      expect(entry).toMatchObject({
        conversationId: "session-a",
        actionStatus: "pending",
        actionExpiresAt,
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
      const now = new Date();
      store.push({
        kind: "session.clarification",
        title: "Old question",
        conversationId: "session-a",
        actionStatus: "pending",
        actionExpiresAt: daysFrom(now, -1),
      });
      store.push({
        kind: "session.clarification",
        title: "Fresh question",
        conversationId: "session-b",
        actionStatus: "pending",
        actionExpiresAt: daysFrom(now, 30),
      });

      expect(store.expireActions(now)).toBe(1);
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

function daysFromNow(days: number): string {
  return daysFrom(new Date(), days);
}

function daysFrom(date: Date, days: number): string {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString();
}
