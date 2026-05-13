import { createFileRoute } from "@tanstack/react-router";
import { PageFrame } from "@/components/page-frame";
import { markAllNotificationsRead } from "@/server/actions.functions";
import { getNotificationsPageState } from "@/server/state.functions";

export const Route = createFileRoute("/notifications")({
  loader: () => getNotificationsPageState(),
  component: NotificationsPage,
});

function NotificationsPage() {
  const state = Route.useLoaderData();
  return (
    <PageFrame eyebrow="Inbox" title="Notifications">
      <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--border))] pb-4">
        <p className="text-sm text-[rgb(var(--muted-foreground))]">
          {state.unreadNotifications} unread, {state.notifications.length} total
        </p>
        <button
          type="button"
          onClick={() => void markAllNotificationsRead()}
          className="rounded-full border border-[rgb(var(--border))] px-3 py-1.5 text-xs text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
        >
          Mark all read
        </button>
      </div>
      <ul className="flex flex-col">
        {state.notifications.length === 0 ? (
          <li className="py-10 text-sm text-[rgb(var(--muted-foreground))]">No notifications yet.</li>
        ) : (
          state.notifications.map((item) => (
            <li key={item.id} className="border-b border-[rgb(var(--border))] py-4 last:border-b-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-[rgb(var(--muted-foreground))]">
                    {notificationLabel(item.kind)}
                  </p>
                  <h2 className="mt-1 text-base font-medium">
                    {item.title}
                  </h2>
                  {item.body ? (
                    <p className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted-foreground))]">
                      {item.body}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-[rgb(var(--muted-foreground))]">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
            </li>
          ))
        )}
      </ul>
    </PageFrame>
  );
}

function notificationLabel(kind: string): string {
  switch (kind) {
    case "memory.written":
      return "Memory";
    case "memory.consolidated":
      return "Memory cleanup";
    case "memory.failed":
      return "Memory needs attention";
    case "session.message":
      return "Conversation";
    case "session.clarification":
      return "Question";
    case "skill.suggested":
      return "Skill suggestion";
    case "task.failed":
      return "Task needs attention";
    case "mount.added":
      return "Files";
    default:
      return "Update";
  }
}
