import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Trash2, X } from "lucide-react";
import { ChatComposer, type SelectedSkill } from "@/components/chat-composer";
import { appendUnique, prependUnique } from "@/components/chat-message-state";
import {
  ChatTimeline,
  countDebugItems,
  type ChatMessageItem,
} from "@/components/chat-timeline";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useChatUi } from "@/components/chat-ui-context";
import { Markdown } from "@/components/markdown";
import { ThemeSync } from "@/components/theme-sync";
import {
  deleteSession,
  sendChatMessage,
  stopChatMessage,
} from "@/server/actions.functions";
import { getSessionMessages } from "@/server/session-messages.functions";
import type { SessionSummaryDto, WebStateDto } from "@/server/dto";
import type { WebLiveEvent } from "../../src/web/live-events";

type ActivityEvent = Extract<WebLiveEvent, { type: "activity" }>;

export function ChatPage({ initialState }: { initialState: WebStateDto }) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeSessionId = useMemo(() => sessionIdFromPath(location.pathname), [location.pathname]);
  // For /chat/:id the URL is the source of truth; only fall back to the
  // loader's activeSessionId on the bare /chat route.
  const resolvedInitialSessionId = routeSessionId ?? initialState.activeSessionId;
  const initialPage = useMemo(
    () => initialState.messagePage ?? {
      items: initialState.messages.map((message, index) => ({
        id: `initial-${message.createdAt}-${index}`,
        message,
      })),
      oldestId: null,
      newestId: null,
      hasMoreBefore: false,
    },
    [initialState.messagePage, initialState.messages],
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    resolvedInitialSessionId,
  );
  const [messages, setMessages] = useState<ChatMessageItem[]>(
    initialPage.items,
  );
  const [oldestMessageId, setOldestMessageId] = useState<number | null>(
    initialPage.oldestId,
  );
  const [hasMoreBefore, setHasMoreBefore] = useState(
    initialPage.hasMoreBefore,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [sessions, setSessions] = useState(initialState.sessions);
  const [activities, setActivities] = useState<Array<Extract<WebLiveEvent, { type: "activity" }>>>([]);
  const [sandboxStatus, setSandboxStatus] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<SelectedSkill[]>([]);
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const activeSessionRef = useRef<string | null>(activeSessionId);
  activeSessionRef.current = activeSessionId;
  const activeSession = useMemo(
    () => sessions.find((s) => s.conversationId === activeSessionId),
    [sessions, activeSessionId],
  );
  const childSessions = useMemo(
    () => activeSessionId
      ? sessions.filter((session) => session.parentSessionId === activeSessionId)
      : [],
    [sessions, activeSessionId],
  );
  const previewSession = useMemo(
    () => sessions.find((session) => session.conversationId === previewSessionId) ?? null,
    [sessions, previewSessionId],
  );

  useEffect(() => {
    setActiveSessionId(resolvedInitialSessionId);
    setMessages(initialPage.items);
    setOldestMessageId(initialPage.oldestId);
    setHasMoreBefore(initialPage.hasMoreBefore);
    setLoadingMore(false);
    setActivities([]);
    setSandboxStatus(null);
    setPreviewSessionId(null);
  }, [resolvedInitialSessionId, initialPage]);
  const { details } = useChatUi();

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WebLiveEvent | { type: "connected" };
      if (event.type === "sessions") setSessions(event.sessions);
      if ("conversationId" in event && event.conversationId === activeSessionRef.current) {
        if (event.type === "message") {
          setMessages((current) =>
            appendUnique(current, { id: event.id, message: event.message }));
        }
        if (event.type === "activity") {
          setActivities((current) => [...current.slice(-79), event]);
          setSandboxStatus((current) => nextSandboxStatus(current, event));
        }
      }
    };
    return () => source.close();
  }, []);

  const debugCount = useMemo(() => countDebugItems(messages, activities), [messages, activities]);

  const loadMoreMessages = useCallback(async (): Promise<boolean> => {
    if (!activeSessionId || !oldestMessageId || loadingMore || !hasMoreBefore) return false;
    setLoadingMore(true);
    try {
      const page = await getSessionMessages({
        data: { conversationId: activeSessionId, beforeId: oldestMessageId, limit: 10 },
      });
      if (page.items.length === 0) {
        setHasMoreBefore(false);
        return false;
      }
      setMessages((current) => prependUnique(current, page.items));
      setOldestMessageId(page.oldestId);
      setHasMoreBefore(page.hasMoreBefore);
      return true;
    } finally {
      setLoadingMore(false);
    }
  }, [activeSessionId, oldestMessageId, loadingMore, hasMoreBefore]);

  async function submit() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    const wasDraft = !activeSessionId;
    const conversationId = activeSessionId ?? crypto.randomUUID();
    if (wasDraft) setActiveSessionId(conversationId);
    const createdAt = new Date().toISOString();
    const isCommand = text.startsWith("/");
    if (!isCommand) {
      setMessages((current) =>
        appendUnique(current, {
          id: `optimistic-user-${createdAt}`,
          message: { role: "user", content: text, createdAt },
        }));
    }
    const skillIds = selectedSkills.map((skill) => skill.id);
    try {
      const result = await sendChatMessage({ data: { conversationId, text, createdAt, skillIds } });
      if (!isCommand) setSelectedSkills([]);
      if (result.activeSessionId !== conversationId) {
        setActiveSessionId(result.activeSessionId);
        await navigate({ to: "/chat/$sessionId", params: { sessionId: result.activeSessionId } });
      } else if (wasDraft) {
        await navigate({ to: "/chat/$sessionId", params: { sessionId: conversationId } });
      }
    } finally {
      setSending(false);
    }
  }

  async function removeActiveSession() {
    if (!activeSessionId) return;
    setDeleting(true);
    try {
      const result = await deleteSession({ data: { conversationId: activeSessionId } });
      const next = result.sessions[0];
      setSessions(result.sessions);
      setDeleteOpen(false);
      if (next) {
        setActiveSessionId(next.conversationId);
        await navigate({ to: "/chat/$sessionId", params: { sessionId: next.conversationId } });
      } else {
        setActiveSessionId(null);
        setMessages([]);
        setOldestMessageId(null);
        setHasMoreBefore(false);
        await navigate({ to: "/sessions" });
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="app-chat-page mx-auto flex min-h-screen w-full flex-col pt-24">
      <ThemeSync ui={initialState.settings.ui} />
      <header className="app-chat-header flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            Aithy
          </p>
          <h1 className="mt-2 text-3xl font-normal">{activeSession?.name ?? "Chat"}</h1>
          {activeSession?.parentSessionId ? (
            <Link
              to="/chat/$sessionId"
              params={{ sessionId: activeSession.parentSessionId }}
              className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
            >
              <ArrowLeft className="h-3 w-3" /> back to parent
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {activeSessionId ? (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              aria-label="Delete session"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))] transition hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-200"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
          {details ? (
            <span className="rounded-full border border-dashed border-[rgb(var(--border))] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              debug · {debugCount} item{debugCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </header>

      <div className="app-chat-timeline mt-8 flex flex-1 flex-col gap-6">
        <ChatTimeline
          messages={messages}
          activities={activities}
          details={details}
          sending={sending}
          sandboxStatus={sandboxStatus}
          resetKey={activeSessionId}
          hasMoreBefore={hasMoreBefore}
          loadingMore={loadingMore}
          onLoadMore={loadMoreMessages}
          subSessions={childSessions}
          onOpenSession={(session) => setPreviewSessionId(session.conversationId)}
        />
      </div>

      <ChatComposer
        input={input}
        sending={sending}
        selectedSkills={selectedSkills}
        onInputChange={setInput}
        onSelectedSkillsChange={setSelectedSkills}
        onSubmit={() => void submit()}
        onStop={() => {
          if (activeSessionId) void stopChatMessage({ data: { conversationId: activeSessionId } });
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete session?"
        body={`Delete "${activeSession?.name ?? "this session"}" and any related task sessions. Active work in this session will be stopped.`}
        confirmLabel="Delete session"
        busy={deleting}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void removeActiveSession()}
      />

      <SubSessionDrawer
        session={previewSession}
        onClose={() => setPreviewSessionId(null)}
      />
    </section>
  );
}

function nextSandboxStatus(
  current: string | null,
  event: ActivityEvent,
): string | null {
  if (
    event.label === "starting sandbox..."
    || event.label === "resuming sandbox..."
    || event.label === "refreshing sandbox mounts..."
  ) {
    return event.label;
  }
  if (
    event.tone === "danger"
    || event.label === "agent completed"
    || event.label.startsWith("sandbox ready:")
    || event.label.startsWith("mounts refreshed:")
  ) {
    return null;
  }
  return current;
}

function sessionIdFromPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function SubSessionDrawer({
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
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close sub-session"
        onClick={onClose}
      />
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
              {messages.map((item) => (
                <PreviewMessage key={item.id} item={item} />
              ))}
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
  return (
    <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-[rgb(var(--muted))] px-4 py-2 font-mono text-xs text-[rgb(var(--muted-foreground))]">
      tool · {message.toolName}
    </div>
  );
}
