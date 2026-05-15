import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink, X } from "lucide-react";
import type { SessionSummaryDto } from "@/server/dto";
import { getSessionMessages } from "@/server/session-messages.functions";
import type { ChatMessageItem } from "@/components/chat-timeline";
import { Markdown } from "@/components/markdown";

export function SubSessionDrawer({
  session,
  onClose,
}: {
  session: SessionSummaryDto | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setMessages([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getSessionMessages({
      data: { conversationId: session.conversationId, beforeId: null, limit: 30 },
    }).then((page) => {
      if (!cancelled) setMessages(page.items);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load session");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close sub-session" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[rgb(var(--border))] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              sub-session
            </div>
            <h2 className="mt-1 truncate text-xl font-normal">{session.name}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/chat/$sessionId"
              params={{ sessionId: session.conversationId }}
              onClick={onClose}
              aria-label="Open full session"
              title="Open full session"
              className="grid h-9 w-9 place-items-center rounded-full border border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sub-session"
              className="grid h-9 w-9 place-items-center rounded-full border border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
              Loading session
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 dark:text-red-300">{error}</div>
          ) : messages.length === 0 ? (
            <div className="text-sm text-[rgb(var(--muted-foreground))]">No messages yet.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {messages.map((item) => <PreviewMessage key={item.id} item={item} />)}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function PreviewMessage({ item }: { item: ChatMessageItem }) {
  const { message } = item;
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-[rgb(var(--accent))] px-4 py-2 text-sm leading-relaxed text-[rgb(var(--accent-foreground))]">
        <Markdown text={message.content} />
      </div>
    );
  }
  if (message.kind === "text") {
    return (
      <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[rgb(var(--bubble-bot))] px-4 py-2 text-sm leading-relaxed">
        <Markdown text={message.content} />
      </div>
    );
  }
  if (message.kind === "artifact") {
    return (
      <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[rgb(var(--panel))] px-4 py-2 text-sm text-[rgb(var(--muted-foreground))]">
        artifact · {message.title}
      </div>
    );
  }
  return (
    <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[rgb(var(--muted))] px-4 py-2 font-mono text-xs text-[rgb(var(--muted-foreground))]">
      tool · {message.toolName}
    </div>
  );
}
