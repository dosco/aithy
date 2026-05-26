import { describe, expect, test } from "bun:test";
import { notificationAttentionDto } from "../app/server/notification-attention";
import { notificationListDto } from "../app/server/notification-list.dto";

describe("notificationAttentionDto", () => {
  test("derives active help from runtime state instead of unread history", () => {
    const attention = notificationAttentionDto({
      runtimeStore: {
        pendingPermissionRequestsAll: () => [{
          id: "permit-1",
          conversationId: "session-a",
          capability: "system.bash",
          toolName: "system.bash",
          command: "pwd",
          cwd: "/tmp",
          reason: "inspect files",
          argsPreview: null,
          targetKind: null,
          targetValue: null,
          matchOptionsJson: null,
          status: "pending",
          createdAt: "2026-05-25T10:00:00.000Z",
          decidedAt: null,
          decisionReason: null,
        }],
      },
      tasks: {
        recent: () => [],
      },
      automations: {
        list: () => [],
      },
      notifications: {
        activeActions: () => [],
      },
    } as any);

    expect(attention).toMatchObject({
      active: true,
      count: 1,
      items: [{
        kind: "permission",
        title: "Command approval needed",
        link: "/chat/session-a",
      }],
    });
  });

  test("includes recent retryable failed chat tasks, needs-input automations, and pending clarifications", () => {
    const attention = notificationAttentionDto({
      runtimeStore: { pendingPermissionRequestsAll: () => [] },
      tasks: {
        recent: (input?: { status?: string }) => input?.status === "active"
          ? []
          : [{
              id: "task-1",
              kind: "chat.turn",
              status: "failed",
              metadata: { text: "hello" },
              errorSummary: "model failed",
              reason: null,
              relatedSessionId: "session-a",
              updatedAt: new Date().toISOString(),
            }, {
              id: "task-ignored",
              kind: "chat.turn",
              status: "failed",
              metadata: {},
              errorSummary: "not retryable",
              reason: null,
              relatedSessionId: "session-a",
              updatedAt: new Date().toISOString(),
            }],
      },
      automations: {
        list: () => [{
          id: "automation-1",
          status: "needs_input",
          title: "Morning check",
          originSessionId: "session-a",
          updatedAt: "2026-05-25T09:00:00.000Z",
        }],
      },
      notifications: {
        activeActions: () => [{
          id: 7,
          kind: "session.clarification",
          title: "Aithy has a question",
          body: "Which repo?",
          link: "/chat/session-a",
          createdAt: "2026-05-25T11:00:00.000Z",
        }],
      },
    } as any);

    expect(attention.active).toBe(true);
    expect(attention.count).toBe(3);
    expect(attention.items.map((item) => item.kind).sort()).toEqual([
      "automation",
      "clarification",
      "task_failed",
    ]);
  });
});

describe("notificationListDto", () => {
  test("returns unread count and separate attention state", () => {
    const result = notificationListDto({
      notifications: {
        recent: () => [{
          id: 1,
          kind: "info",
          title: "Old note",
          body: null,
          link: null,
          read: false,
          conversationId: null,
          actionStatus: "none",
          actionExpiresAt: null,
          resolvedAt: null,
          createdAt: "2026-05-20T10:00:00.000Z",
        }],
        unreadCount: () => 1,
        activeActions: () => [],
      },
      runtimeStore: { pendingPermissionRequestsAll: () => [] },
      tasks: { recent: () => [] },
      automations: { list: () => [] },
    } as any);

    expect(result.unread).toBe(1);
    expect(result.notificationAttention).toMatchObject({
      active: false,
      count: 0,
      label: "All caught up",
    });
    expect(result.notifications[0]).toMatchObject({
      title: "Old note",
      read: false,
      actionStatus: "none",
    });
  });
});
