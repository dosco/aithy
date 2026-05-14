import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import { ChatComposer, type SelectedSkill } from "@/components/chat-composer";
import { appendUnique } from "@/components/chat-message-state";
import {
  ChatTimeline,
  countDebugItems,
} from "@/components/chat-timeline";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useChatUi } from "@/components/chat-ui-context";
import { useLiveEvent } from "@/components/live-events";
import {
  appendSetupStatus,
  compactSetupStatuses,
  queueStatusToSetup,
  sessionIdFromPath,
  type SetupStatusEvent,
} from "@/components/chat-page-helpers";
import { SubSessionDrawer } from "@/components/sub-session-drawer";
import { ThemeSync } from "@/components/theme-sync";
import { useChatMessages } from "@/components/use-chat-messages";
import {
  deleteSession,
  respondSystemPermission,
  sendChatMessage,
  stopChatMessage,
} from "@/server/actions.functions";
import type { WebStateDto } from "@/server/dto";
import type { WebLiveEvent } from "../../src/web/live-events";

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
  const {
    messages,
    setMessages,
    hasMoreBefore,
    loadingMore,
    loadMoreMessages,
    clearMessages,
  } = useChatMessages(resolvedInitialSessionId, initialPage);
  const [sessions, setSessions] = useState(initialState.sessions);
  const initialActivities = useMemo(
    () => initialState.activities ?? [],
    [initialState.activities],
  );
  const [activities, setActivities] =
    useState<Array<Extract<WebLiveEvent, { type: "activity" }>>>(initialActivities);
  const [permissionRequests, setPermissionRequests] = useState(initialState.pendingPermissions);
  const [setupStatuses, setSetupStatuses] = useState<SetupStatusEvent[]>([]);
  const [input, setInput] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<SelectedSkill[]>([]);
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const activeSessionRef = useRef<string | null>(activeSessionId);
  const setupClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    setActivities(initialActivities);
    setPermissionRequests(initialState.pendingPermissions);
    clearSetupStatusLog();
    setPreviewSessionId(null);
  }, [resolvedInitialSessionId, initialPage, initialActivities, initialState.pendingPermissions]);
  const { details } = useChatUi();
  const visibleSetupStatuses = useMemo(() => compactSetupStatuses(setupStatuses), [setupStatuses]);

  useLiveEvent((event) => {
    if (event.type === "sessions") setSessions(event.sessions);
    if (event.type === "setup-status") {
      cancelSetupStatusClear();
      setSetupStatuses((current) => appendSetupStatus(current, event));
    }
    if (event.type === "queue-status" && event.queue.id === "agent.chat") {
      cancelSetupStatusClear();
      setSetupStatuses((current) => appendSetupStatus(current, queueStatusToSetup(event)));
    }
    if ("conversationId" in event && event.conversationId === activeSessionRef.current) {
      if (event.type === "message") {
        setMessages((current) =>
          appendUnique(current, { id: event.id, message: event.message }));
        if (event.message.role === "assistant" && event.message.kind === "permission") {
          const requestId = event.message.requestId;
          setPermissionRequests((current) =>
            current.filter((request) => request.id !== requestId));
        }
        if (event.message.role === "assistant") {
          setSending(false);
          scheduleSetupStatusClear();
        }
      }
      if (event.type === "permission-request") {
        setPermissionRequests((current) => updatePermissionRequests(current, event.request));
      }
      if (event.type === "activity") {
        setActivities((current) => [...current.slice(-79), event]);
      }
    }
  });

  useEffect(() => () => cancelSetupStatusClear(), []);

  const debugCount = useMemo(() => countDebugItems(messages, activities), [messages, activities]);

  async function submit() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    clearSetupStatusLog();
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
    let keepSending = false;
    try {
      const result = await sendChatMessage({ data: { conversationId, text, createdAt, skillIds } });
      keepSending = Boolean(result.queued && !isCommand);
      if (!isCommand) setSelectedSkills([]);
      if (result.activeSessionId !== conversationId) {
        setActiveSessionId(result.activeSessionId);
        await navigate({ to: "/chat/$sessionId", params: { sessionId: result.activeSessionId } });
      } else if (wasDraft) {
        await navigate({ to: "/chat/$sessionId", params: { sessionId: conversationId } });
      }
    } finally {
      if (!keepSending) setSending(false);
    }
  }

  function cancelSetupStatusClear() {
    if (!setupClearTimerRef.current) return;
    clearTimeout(setupClearTimerRef.current);
    setupClearTimerRef.current = null;
  }

  function clearSetupStatusLog() {
    cancelSetupStatusClear();
    setSetupStatuses([]);
  }

  function scheduleSetupStatusClear() {
    cancelSetupStatusClear();
    setupClearTimerRef.current = setTimeout(() => {
      setupClearTimerRef.current = null;
      setSetupStatuses([]);
    }, 1600);
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
        clearMessages();
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
          permissionRequests={permissionRequests}
          details={details}
          sending={sending}
          resetKey={activeSessionId}
          hasMoreBefore={hasMoreBefore}
          loadingMore={loadingMore}
          onLoadMore={loadMoreMessages}
          subSessions={childSessions}
          onOpenSession={(session) => setPreviewSessionId(session.conversationId)}
          onPermissionDecision={(requestId, decision) => {
            setPermissionRequests((current) =>
              current.map((request) =>
                request.id === requestId ? { ...request, status: decision === "allow" ? "allowed" : "denied" } : request
              ));
            void respondSystemPermission({ data: { requestId, decision } });
          }}
        />
      </div>

      <ChatComposer
        input={input}
        sending={sending}
        setupStatuses={visibleSetupStatuses}
        selectedSkills={selectedSkills}
        onInputChange={setInput}
        onSelectedSkillsChange={setSelectedSkills}
        onSubmit={() => void submit()}
        onStop={() => {
          setSending(false);
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

function updatePermissionRequests(
  current: WebStateDto["pendingPermissions"],
  request: WebStateDto["pendingPermissions"][number],
) {
  const index = current.findIndex((item) => item.id === request.id);
  if (index === -1) return [...current, request];
  return current.map((item) => item.id === request.id ? request : item);
}
