import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CornerDownRight, Trash2 } from "lucide-react";
import { ChatComposer, type SelectedSkill } from "@/components/chat-composer";
import {
  ChatTimeline,
  countDebugItems,
  type ChatMessageItem,
} from "@/components/chat-timeline";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useChatUi } from "@/components/chat-ui-context";
import { ThemeSync } from "@/components/theme-sync";
import {
  getChildSessions,
  deleteSession,
  sendChatMessage,
  stopChatMessage,
} from "@/server/actions.functions";
import { getSessionMessages } from "@/server/session-messages.functions";
import type { SessionSummaryDto, WebStateDto } from "@/server/dto";
import type {
  SerializableBotMessage,
  WebLiveEvent,
} from "../../src/web/live-events";

type ActivityEvent = Extract<WebLiveEvent, { type: "activity" }>;

export function ChatPage({ initialState }: { initialState: WebStateDto }) {
  const navigate = useNavigate();
  const location = useLocation();
  const routeSessionId = useMemo(() => sessionIdFromPath(location.pathname), [location.pathname]);
  const resolvedInitialSessionId = initialState.activeSessionId ?? routeSessionId;
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
  const [children, setChildren] = useState<SessionSummaryDto[]>([]);
  const activeSession = useMemo(
    () => sessions.find((s) => s.conversationId === activeSessionId),
    [sessions, activeSessionId],
  );

  useEffect(() => {
    setActiveSessionId(resolvedInitialSessionId);
    setMessages(initialPage.items);
    setOldestMessageId(initialPage.oldestId);
    setHasMoreBefore(initialPage.hasMoreBefore);
    setLoadingMore(false);
    setActivities([]);
    setSandboxStatus(null);
  }, [resolvedInitialSessionId, initialPage]);

  useEffect(() => {
    if (!activeSessionId || messages.length > 0) return;
    let cancelled = false;
    void getSessionMessages({ data: { conversationId: activeSessionId, limit: 10 } })
      .then((page) => {
        if (cancelled) return;
        setMessages(page.items);
        setOldestMessageId(page.oldestId);
        setHasMoreBefore(page.hasMoreBefore);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, messages.length]);

  useEffect(() => {
    if (!activeSessionId) {
      setChildren([]);
      return;
    }
    let cancelled = false;
    void getChildSessions({ data: { parentSessionId: activeSessionId } }).then((rows) => {
      if (!cancelled) setChildren(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);
  const { details } = useChatUi();

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WebLiveEvent | { type: "connected" };
      if (event.type === "sessions") setSessions(event.sessions);
      if ("conversationId" in event && event.conversationId === activeSessionId) {
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
  }, [activeSessionId]);

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
    const skillIds = selectedSkills.map((skill) => skill.id);
    const result = await sendChatMessage({ data: { conversationId, text, skillIds } });
    if (!text.startsWith("/")) setSelectedSkills([]);
    setMessages((current) =>
      appendUnique(current, { id: `reply-${result.reply.createdAt}`, message: result.reply }));
    if (result.activeSessionId !== conversationId) {
      setActiveSessionId(result.activeSessionId);
      await navigate({ to: "/chat/$sessionId", params: { sessionId: result.activeSessionId } });
    } else if (wasDraft) {
      await navigate({ to: "/chat/$sessionId", params: { sessionId: conversationId } });
    }
    setSending(false);
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
          {children.length > 0 ? (
            <SubSessionStrip entries={children} />
          ) : null}
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

    </section>
  );
}

function appendUnique(
  messages: ChatMessageItem[],
  next: ChatMessageItem,
): ChatMessageItem[] {
  const exists = messages.some(({ message }) =>
    message.role === next.message.role
    && message.createdAt === next.message.createdAt
    && contentOf(message) === contentOf(next.message)
  );
  return exists ? messages : [...messages, next];
}

function prependUnique(
  messages: ChatMessageItem[],
  previous: ChatMessageItem[],
): ChatMessageItem[] {
  const currentIds = new Set(messages.map((message) => message.id));
  return [
    ...previous.filter((message) => !currentIds.has(message.id)),
    ...messages,
  ];
}

function contentOf(message: SerializableBotMessage): string {
  if (message.role === "user") return message.content;
  if (message.kind === "text") return message.content;
  return `${message.toolName}:${JSON.stringify(message.toolArgs)}`;
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

function SubSessionStrip({ entries }: { entries: SessionSummaryDto[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--border))] px-3 py-1 text-xs text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <CornerDownRight className="h-3 w-3" />
        {entries.length} sub-session{entries.length === 1 ? "" : "s"}
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-lg">
          <ul className="grid divide-y divide-[rgb(var(--border))]">
            {entries.map((entry) => (
              <li key={entry.conversationId}>
                <Link
                  to="/chat/$sessionId"
                  params={{ sessionId: entry.conversationId }}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-xs transition hover:bg-[rgb(var(--muted))]/40"
                >
                  <div className="truncate font-medium">{entry.name}</div>
                  <div className="truncate text-[rgb(var(--muted-foreground))]">
                    {entry.conversationId}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
