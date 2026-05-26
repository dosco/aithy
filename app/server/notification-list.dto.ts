import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { notificationDto } from "./dto-mappers";
import { notificationAttentionDto } from "./notification-attention";

export function notificationListDto(runtime: AithyRuntime) {
  return {
    notifications: runtime.notifications.recent(5).map(notificationDto),
    unread: runtime.notifications.unreadCount(),
    notificationAttention: notificationAttentionDto(runtime),
  };
}
