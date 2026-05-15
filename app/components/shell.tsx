import { Link, useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  Brain,
  Eye,
  EyeOff,
  History,
  Menu,
  MessageSquareText,
  Palette,
  Settings,
  SquarePen,
  ListChecks,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChatUiProvider, useChatUi } from "@/components/chat-ui-context";
import { ConsoleButton } from "@/components/console/console-button";
import { LiveEventsProvider } from "@/components/live-events";
import { NotificationBell } from "@/components/notification-bell";
import { SessionRail } from "@/components/session-rail";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { getSessionsPageState } from "@/server/state.functions";

const navItems = [
  { to: "/sessions", label: "Sessions", icon: History },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/skills", label: "Skills", icon: BookOpen },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/themes", label: "Themes", icon: Palette },
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
  const reduce = useReducedMotion();
  const showDetails =
    location.pathname.startsWith("/chat") ||
    location.pathname.startsWith("/sessions");
  const [expanded, setExpanded] = useState(false);
  const [lastActiveSessionId, setLastActiveSessionId] = useState<string | null>(
    null,
  );
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSessionsPageState().then((state) => {
      if (!cancelled)
        setLastActiveSessionId(state.settings.ui.lastActiveSessionId);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const match = /^\/chat\/([^/]+)/.exec(location.pathname);
    if (match) setLastActiveSessionId(decodeURIComponent(match[1]));
  }, [location.pathname]);

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

  const transition = reduce
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 30 };

  return (
    <header className="pointer-events-none fixed left-0 right-0 top-4 z-30">
      <div
        className={cn(
          "pointer-events-auto absolute right-4 top-0 flex items-center gap-1 overflow-visible rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.9)] p-1 shadow-lg shadow-black/5 backdrop-blur-xl sm:right-6 lg:right-8",
          showDetails ? "w-64" : "w-[13.75rem]",
        )}
      >
        <TopIconLink
          to="/chat"
          active={location.pathname === "/chat"}
          label="New chat"
        >
          <SquarePen className="h-4 w-4" />
        </TopIconLink>
        {lastActiveSessionId ? (
          <TopIconLink
            to="/chat/$sessionId"
            params={{ sessionId: lastActiveSessionId }}
            active={location.pathname === `/chat/${lastActiveSessionId}`}
            label="Active chat"
          >
            <MessageSquareText className="h-4 w-4" />
          </TopIconLink>
        ) : (
          <TopIconLink to="/chat" active={false} label="Active chat">
            <MessageSquareText className="h-4 w-4" />
          </TopIconLink>
        )}
        <NotificationBell />
        <ConsoleButton />
        <ThemeToggle />
        {showDetails ? <DetailsToggle /> : null}
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
                className="absolute right-0 top-11 flex w-64 origin-top-right flex-col gap-1 rounded-3xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.96)] p-2 shadow-xl shadow-black/10 backdrop-blur-xl"
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = location.pathname.startsWith(item.to);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors",
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
              </motion.div>
            ) : null}
          </AnimatePresence>
        </nav>
      </div>
    </header>
  );
}

function topIconClass(active = false): string {
  return cn(
    "flex h-8 w-8 items-center justify-center rounded-full transition",
    active
      ? "bg-[rgb(var(--muted))] text-[rgb(var(--foreground))]"
      : "text-[rgb(var(--foreground))] hover:bg-[rgb(var(--muted))]",
  );
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
  to: "/chat" | "/chat/$sessionId";
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

function DetailsToggle() {
  const { details, setDetails } = useChatUi();
  return (
    <button
      onClick={() => setDetails(!details)}
      aria-label="Toggle activity details"
      className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[rgb(var(--muted))]"
    >
      {details ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
    </button>
  );
}
