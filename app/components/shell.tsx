import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  Brain,
  Bug,
  Cpu,
  Eye,
  History,
  House,
  ListChecks,
  Menu,
  Network,
  Palette,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChatUiProvider, useChatUi } from "@/components/chat-ui-context";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConsoleButton } from "@/components/console/console-button";
import { LiveEventsProvider, useLiveEvent } from "@/components/live-events";
import { NotificationBell } from "@/components/notification-bell";
import { SessionRail } from "@/components/session-rail";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { deleteSession } from "@/server/actions.functions";
import type { SessionsPageStateDto } from "@/server/dto";
import { getSessionsPageState } from "@/server/state.functions";
import { HOME_SESSION_ID } from "../../src/session/home-session";

const navItems = [
  { to: "/skills", label: "Skills", icon: BookOpen },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/attentions", label: "Attentions", icon: Eye },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/mesh", label: "Mesh", icon: Network },
  { to: "/inference", label: "Inference", icon: Cpu },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/themes", label: "Themes", icon: Palette },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const showRail =
    location.pathname.startsWith("/chat") ||
    location.pathname.startsWith("/sessions");
  return (
    <ChatUiProvider>
      <LiveEventsProvider>
        <div className="min-h-screen">
          <TopChrome />
          <main className="app-shell-main mx-auto min-h-screen w-full px-4 py-5 sm:px-8">
            {children}
          </main>
          {showRail ? <SessionRail /> : null}
        </div>
      </LiveEventsProvider>
    </ChatUiProvider>
  );
}

function TopChrome() {
  const location = useLocation();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { details, setDetails } = useChatUi();
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState<SessionsPageStateDto["sessions"]>([]);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionId = useMemo(() => {
    const match = /^\/chat\/([^/]+)/.exec(location.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }, [location.pathname]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.conversationId === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const pendingDeleteSession = useMemo(
    () => sessions.find((session) => session.conversationId === pendingDeleteSessionId) ?? null,
    [sessions, pendingDeleteSessionId],
  );

  useEffect(() => {
    let cancelled = false;
    void getSessionsPageState().then((state) => {
      if (!cancelled) setSessions(state.sessions);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useLiveEvent((event) => {
    if (event.type === "sessions") setSessions(event.sessions);
  });

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    [],
  );

  function open() {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setExpanded(true);
  }
  function scheduleClose() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setExpanded(false), 250);
  }

  function openDeleteDialog() {
    if (!activeSessionId || activeSessionId === HOME_SESSION_ID) return;
    setPendingDeleteSessionId(activeSessionId);
    setExpanded(false);
  }

  async function removePendingSession() {
    if (!pendingDeleteSessionId) return;
    setDeleting(true);
    try {
      const result = await deleteSession({ data: { conversationId: pendingDeleteSessionId } });
      const next = result.sessions[0] ?? null;
      setSessions(result.sessions);
      setPendingDeleteSessionId(null);
      if (next) {
        await navigate({ to: "/chat/$sessionId", params: { sessionId: next.conversationId } });
      } else {
        await navigate({ to: "/sessions" });
      }
    } finally {
      setDeleting(false);
    }
  }

  const transition = reduce
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 30 };

  return (
    <>
      <header className="pointer-events-none fixed left-0 right-0 top-4 z-30">
        <BrandLink />
        <div
          className="pointer-events-auto absolute right-4 top-0 flex w-[16.25rem] items-center gap-1 overflow-visible rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.78)] p-1 shadow-[0_4px_18px_rgb(0_0_0/0.06)] backdrop-blur-xl sm:right-6 lg:right-8"
        >
          <TopIconLink
            to="/chat/$sessionId"
            params={{ sessionId: HOME_SESSION_ID }}
            active={activeSessionId === HOME_SESSION_ID}
            label="Home"
          >
            <House className="h-4 w-4" />
          </TopIconLink>
          <TopIconLink
            to="/sessions"
            active={location.pathname.startsWith("/sessions")}
            label="Sessions"
          >
            <History className="h-4 w-4" />
          </TopIconLink>
          <TopIconButton
            active={location.pathname === "/chat"}
            label="New chat"
            onClick={() => void navigate({ to: "/chat" })}
          >
            <SquarePen className="h-4 w-4" />
          </TopIconButton>
          <NotificationBell />
          <ConsoleButton />
          <ThemeToggle />
          <nav
            className="relative"
            onMouseEnter={open}
            onMouseLeave={scheduleClose}
            onFocusCapture={open}
            onBlurCapture={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget as Node | null)
              )
                scheduleClose();
            }}
          >
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setExpanded((current) => !current)}
              className={topIconClass(expanded)}
            >
              <Menu className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <AnimatePresence initial={false}>
              {expanded ? (
                <motion.div
                  key="expanded"
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={transition}
                  className="absolute right-0 top-11 flex w-64 origin-top-right flex-col gap-1 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.96)] p-2 shadow-[0_12px_34px_rgb(0_0_0/0.12)] backdrop-blur-xl"
                >
                  {activeSessionId ? (
                    <SessionMenuActions
                      canDelete={activeSessionId !== HOME_SESSION_ID}
                      details={details}
                      onDelete={openDeleteDialog}
                      onToggleDetails={() => {
                        setDetails(!details);
                        setExpanded(false);
                      }}
                    />
                  ) : null}
                  <div className={activeSessionId ? "mt-1 border-t border-[rgb(var(--border)/0.45)] pt-1" : "grid gap-1"}>
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const active = location.pathname.startsWith(item.to);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={cn(
                            "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                            active
                              ? "bg-[rgb(var(--muted))] text-[rgb(var(--foreground))]"
                              : "hover:bg-[rgb(var(--muted))]",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="whitespace-nowrap">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </nav>
        </div>
      </header>
      <ConfirmDialog
        open={Boolean(pendingDeleteSessionId)}
        title="Delete session?"
        body={`Delete "${pendingDeleteSession?.name ?? activeSession?.name ?? "this session"}" and any related task sessions. Active work in this session will be stopped.`}
        confirmLabel="Delete session"
        busy={deleting}
        onCancel={() => setPendingDeleteSessionId(null)}
        onConfirm={() => void removePendingSession()}
      />
    </>
  );
}

function SessionMenuActions({
  canDelete,
  details,
  onDelete,
  onToggleDetails,
}: {
  canDelete: boolean;
  details: boolean;
  onDelete: () => void;
  onToggleDetails: () => void;
}) {
  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={onToggleDetails}
        className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--muted))]"
      >
        <Bug className="h-4 w-4" />
        <span className="flex-1 whitespace-nowrap">Debug mode</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--muted-foreground))]">
          {details ? "On" : "Off"}
        </span>
      </button>
      {canDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--danger)/0.09)] hover:text-[rgb(var(--danger))]"
        >
          <Trash2 className="h-4 w-4" />
          <span className="whitespace-nowrap">Delete session</span>
        </button>
      ) : null}
    </div>
  );
}

function BrandLink() {
  return (
    <Link
      to="/chat/$sessionId"
      params={{ sessionId: HOME_SESSION_ID }}
      aria-label="Aithy home"
      className="pointer-events-auto absolute left-4 top-1.5 font-mono text-[11px] uppercase tracking-[0.24em] text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))] sm:left-6 lg:left-8"
    >
      Aithy
    </Link>
  );
}

function topIconClass(active = false): string {
  return cn("app-top-icon", active && "app-top-icon-active");
}

function TopIconLink({
  active,
  children,
  label,
  params,
  to,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  params?: Record<string, string>;
  to: "/chat" | "/chat/$sessionId" | "/sessions";
}) {
  return (
    <Link
      to={to}
      params={params}
      aria-label={label}
      title={label}
      className={topIconClass(active)}
    >
      {children}
    </Link>
  );
}

function TopIconButton({
  active,
  children,
  label,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={topIconClass(active)}
    >
      {children}
    </button>
  );
}
