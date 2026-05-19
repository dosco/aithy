import { useEffect, useState } from "react";
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
import type { NotificationDto } from "@/server/dto";
import type { WebLiveEvent } from "../../src/web/live-events";

type IncomingNotification = Extract<WebLiveEvent, { type: "notification" }>["notification"];

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    void refresh();
  }, []);

  useLiveEvent((event) => {
    if (event.type !== "notification") return;
    const incoming = event.notification;
    setItems((prev) => mergeIncoming(prev, incoming));
    setUnread((n) => n + 1);
  });

  async function refresh() {
    const result = await listNotifications();
    setItems(result.notifications);
    setUnread(result.unread);
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

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          className={cn("app-top-icon relative", open && "app-top-icon-active")}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[rgb(var(--accent))] px-1 text-[9px] font-medium text-[rgb(var(--accent-foreground))]">
              {unread > 99 ? "99+" : unread}
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
                {unread > 0 ? `${unread} unread` : "All caught up"}
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
            {items.length === 0 ? (
              <li className="px-4 py-7 text-center text-sm text-[rgb(var(--muted-foreground))]">
                Nothing new right now.
              </li>
            ) : (
              items.map((n) => <NotificationRow key={n.id} item={n} onActivate={activate} />)
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NotificationRow({
  item,
  onActivate,
}: {
  item: NotificationDto;
  onActivate: (item: NotificationDto) => void;
}) {
  const inner = (
    <div className="flex gap-3 px-3 py-2.5">
      <span
        className={cn(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          item.read ? "bg-[rgb(var(--border))]" : "bg-[rgb(var(--accent))]",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div
            className={cn(
              "min-w-0 truncate text-sm",
              item.read ? "text-[rgb(var(--foreground))]" : "font-medium",
            )}
          >
            {item.title}
          </div>
          <span className="shrink-0 text-[10px] text-[rgb(var(--muted-foreground))]">
            {relativeTime(item.createdAt)}
          </span>
        </div>
        {item.body ? (
          <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-[rgb(var(--muted-foreground))]">
            {item.body}
          </div>
        ) : null}
      </div>
    </div>
  );
  const className = cn(
    "block w-full rounded-md text-left transition",
    item.read
      ? "hover:bg-[rgb(var(--muted))]/50"
      : "bg-[rgb(var(--muted))]/45 hover:bg-[rgb(var(--muted))]/70",
  );
  if (item.link) {
    return (
      <li>
        <Link to={item.link} onClick={() => onActivate(item)} className={className}>
          {inner}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={() => onActivate(item)} className={cn(className, "w-full")}>
        {inner}
      </button>
    </li>
  );
}

function mergeIncoming(prev: NotificationDto[], incoming: IncomingNotification): NotificationDto[] {
  if (prev.some((n) => n.id === incoming.id)) return prev;
  const dto: NotificationDto = {
    id: incoming.id,
    kind: incoming.kind as NotificationDto["kind"],
    title: incoming.title,
    body: incoming.body,
    link: incoming.link,
    read: false,
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
