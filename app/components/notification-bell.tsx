import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import * as Popover from "@radix-ui/react-popover";
import { Bell, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/actions.functions";
import type { NotificationDto } from "@/server/dto";
import type { WebLiveEvent } from "../../src/web/live-events";

type IncomingNotification = Extract<WebLiveEvent, { type: "notification" }>["notification"];

const KIND_TINT: Record<string, string> = {
  "memory.written": "text-emerald-600 dark:text-emerald-400",
  "memory.consolidated": "text-violet-600 dark:text-violet-400",
  "memory.failed": "text-red-600 dark:text-red-400",
  "session.message": "text-sky-600 dark:text-sky-400",
  "session.clarification": "text-amber-600 dark:text-amber-400",
  "skill.suggested": "text-violet-600 dark:text-violet-400",
  "task.failed": "text-red-600 dark:text-red-400",
  "info": "text-[rgb(var(--muted-foreground))]",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as WebLiveEvent | { type: "connected" };
      if (event.type !== "notification") return;
      const incoming = event.notification;
      setItems((prev) => mergeIncoming(prev, incoming));
      setUnread((n) => n + 1);
    };
    return () => source.close();
  }, []);

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
          className="relative flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[rgb(var(--muted))]"
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
          className="z-40 flex max-h-96 w-80 flex-col overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-xl outline-none"
        >
          <div className="flex items-center justify-between border-b border-[rgb(var(--border))] px-3 py-2">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
            >
              Notifications
            </Link>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() => void clearAll()}
                className="inline-flex items-center gap-1 text-[10px] text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
              >
                <Check className="h-3 w-3" /> mark all read
              </button>
            ) : null}
          </div>
          <ul className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <li className="px-4 py-8 text-center text-xs text-[rgb(var(--muted-foreground))]">
                nothing yet.
              </li>
            ) : (
              items.map((n) => <NotificationRow key={n.id} item={n} onActivate={activate} />)
            )}
          </ul>
          <div className="border-t border-[rgb(var(--border))] px-3 py-2">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-center rounded-full border border-[rgb(var(--border))] px-3 py-1.5 text-[10px] text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
            >
              More
            </Link>
          </div>
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
  const tint = KIND_TINT[item.kind] ?? KIND_TINT.info;
  const inner = (
    <div className="grid gap-0.5 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className={cn("font-mono text-[10px] uppercase tracking-wide", tint)}>
          {item.kind}
        </span>
        <span className="shrink-0 text-[10px] text-[rgb(var(--muted-foreground))]">
          {relativeTime(item.createdAt)}
        </span>
      </div>
      <div
        className={cn(
          "text-sm",
          item.read ? "text-[rgb(var(--muted-foreground))]" : "font-medium",
        )}
      >
        {item.title}
      </div>
      {item.body ? (
        <div className="line-clamp-2 text-xs text-[rgb(var(--muted-foreground))]">{item.body}</div>
      ) : null}
    </div>
  );
  const className = cn(
    "block w-full border-b border-[rgb(var(--border))] text-left transition last:border-b-0",
    item.read ? "" : "bg-[rgb(var(--muted))]/30 hover:bg-[rgb(var(--muted))]/50",
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
