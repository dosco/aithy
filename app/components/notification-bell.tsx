import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import * as Popover from "@radix-ui/react-popover";
import { Bell, Check, ChevronRight } from "lucide-react";
import { useLiveEvent } from "@/components/live-events";
import { cn } from "@/lib/utils";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/actions.functions";
import type { NotificationAttentionDto, NotificationDto } from "@/server/dto";
import type { WebLiveEvent } from "../../src/web/live-events";

type IncomingNotification = Extract<WebLiveEvent, { type: "notification" }>["notification"];
type NotificationListItem =
  | { kind: "notification"; item: NotificationDto; active: boolean }
  | {
    kind: "attention";
    id: string;
    title: string;
    body: string | null;
    link: string | null;
    createdAt: string;
  };

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);
  const [attention, setAttention] = useState<NotificationAttentionDto>({
    active: false,
    count: 0,
    label: "All caught up",
    items: [],
  });
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    void refresh();
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  useLiveEvent((event) => {
    if (event.type === "notification") {
      const incoming = event.notification;
      setItems((prev) => mergeIncoming(prev, incoming));
      if (!incoming.read) setUnread((n) => n + 1);
    }
    if (
      event.type === "notification"
      || event.type === "permission-request"
      || event.type === "task-status"
      || event.type === "message"
    ) {
      scheduleRefresh();
    }
  });

  async function refresh() {
    const result = await listNotifications();
    setItems(result.notifications);
    setUnread(result.unread);
    setAttention(result.notificationAttention);
  }

  function scheduleRefresh() {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 250);
  }

  async function activate(item: NotificationDto) {
    if (!item.read) {
      const res = await markNotificationRead({ data: { id: item.id } });
      setUnread(res.unread);
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    }
    setOpen(false);
  }

  async function clearAll() {
    const res = await markAllNotificationsRead();
    setUnread(res.unread);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const rows = notificationRows(attention, items);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={attention.active
            ? `Notifications: ${attention.label}`
            : `Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          className={cn("app-top-icon relative", open && "app-top-icon-active")}
        >
          <Bell className="h-4 w-4" />
          {attention.active ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-[rgb(var(--background))] bg-[rgb(var(--accent))] px-1 text-[9px] font-semibold text-[rgb(var(--accent-foreground))] shadow-[0_0_0_2px_rgb(var(--background)),0_3px_8px_rgb(var(--accent)/0.22)]">
              {attention.count > 9 ? "9+" : attention.count}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="z-40 flex max-h-96 w-[22rem] flex-col overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-2 shadow-[0_12px_34px_rgb(0_0_0/0.12)] outline-none"
        >
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Notifications</div>
              <div className="text-[11px] text-[rgb(var(--muted-foreground))]">
                {attention.active ? attention.label : "All caught up"}
                {unread > 0 ? ` · ${unread} unread` : ""}
              </div>
            </div>
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
              title="View all notifications"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void clearAll()}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
                title="Mark all read"
              >
                <Check className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
            {rows.length === 0 ? (
              <li className="px-4 py-7 text-center text-sm text-[rgb(var(--muted-foreground))]">
                Nothing new right now.
              </li>
            ) : (
              rows.map((row) => (
                <NotificationRow
                  key={rowKey(row)}
                  row={row}
                  onActivate={activate}
                  onClose={() => setOpen(false)}
                />
              ))
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationRow({
  row,
  onActivate,
  onClose,
}: {
  row: NotificationListItem;
  onActivate: (item: NotificationDto) => void;
  onClose: () => void;
}) {
  const title = row.kind === "notification" ? row.item.title : row.title;
  const body = row.kind === "notification" ? row.item.body : row.body;
  const link = row.kind === "notification" ? row.item.link : row.link;
  const createdAt = row.kind === "notification" ? row.item.createdAt : row.createdAt;
  const read = row.kind === "notification" ? row.item.read && !row.active : false;
  const inner = (
    <div className="flex gap-3 px-3 py-2.5">
      <span
        className={cn(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          read ? "bg-[rgb(var(--border))]" : "bg-[rgb(var(--foreground))]/70",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              "min-w-0 truncate text-sm",
              read ? "text-[rgb(var(--foreground))]" : "font-medium",
            )}
          >
            {title}
          </div>
          <span className="shrink-0 text-[10px] text-[rgb(var(--muted-foreground))]">
            {relativeTime(createdAt)}
          </span>
        </div>
        {body ? (
          <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-[rgb(var(--muted-foreground))]">
            {body}
          </div>
        ) : null}
      </div>
    </div>
  );
  const className = cn(
    "block w-full rounded-md text-left transition",
    read
      ? "hover:bg-[rgb(var(--muted))]/50"
      : "bg-[rgb(var(--muted))]/45 hover:bg-[rgb(var(--muted))]/70",
  );
  const activate = () => {
    if (row.kind === "notification") onActivate(row.item);
    else onClose();
  };
  if (link) {
    return (
      <li>
        <Link to={link} onClick={activate} className={className}>
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={activate} className={cn(className, "w-full")}>
        {inner}
      </button>
    </li>
  );
}

function notificationRows(
  attention: NotificationAttentionDto,
  items: NotificationDto[],
): NotificationListItem[] {
  const attentionRows: Array<Extract<NotificationListItem, { kind: "attention" }>> = attention.items.map((item) => ({
    kind: "attention",
    id: item.id,
    title: item.title,
    body: item.body,
    link: item.link,
    createdAt: item.createdAt,
  }));
  const notificationRows = items
    .filter((item) => !attentionRows.some((row) => sameNotification(row, item)))
    .map((item) => ({
      kind: "notification" as const,
      item,
      active: item.actionStatus === "pending",
    }));
  return [...attentionRows, ...notificationRows]
    .sort((a, b) => rowCreatedAt(b).localeCompare(rowCreatedAt(a)))
    .slice(0, 8);
}

function sameNotification(row: Extract<NotificationListItem, { kind: "attention" }>, item: NotificationDto): boolean {
  return row.link === item.link && row.body === item.body;
}

function rowKey(row: NotificationListItem): string {
  return row.kind === "notification" ? `notification-${row.item.id}` : `attention-${row.id}`;
}

function rowCreatedAt(row: NotificationListItem): string {
  return row.kind === "notification" ? row.item.createdAt : row.createdAt;
}

function mergeIncoming(prev: NotificationDto[], incoming: IncomingNotification): NotificationDto[] {
  if (prev.some((n) => n.id === incoming.id)) return prev;
  const dto: NotificationDto = {
    id: incoming.id,
    kind: incoming.kind as NotificationDto["kind"],
    title: incoming.title,
    body: incoming.body,
    link: incoming.link,
    read: incoming.read ?? false,
    conversationId: incoming.conversationId ?? null,
    actionStatus: incoming.actionStatus ?? "none",
    actionExpiresAt: incoming.actionExpiresAt ?? null,
    resolvedAt: incoming.resolvedAt ?? null,
    createdAt: incoming.createdAt,
  };
  return [dto, ...prev].slice(0, 5);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
