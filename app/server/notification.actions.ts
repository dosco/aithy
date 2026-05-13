import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { notificationIdInput } from "./action-schemas";
import { notificationDto } from "./dto";

export const listNotifications = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return {
      notifications: runtime.notifications.recent(5).map(notificationDto),
      unread: runtime.notifications.unreadCount(),
    };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .inputValidator(notificationIdInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.notifications.markRead(data.id);
    return { unread: runtime.notifications.unreadCount() };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const cleared = runtime.notifications.markAllRead();
    return { cleared, unread: runtime.notifications.unreadCount() };
  });
