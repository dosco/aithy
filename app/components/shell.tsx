import { Link, useLocation } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  Brain,
  Eye,
  EyeOff,
  Menu,
  MessageCircle,
  MessagesSquare,
  Palette,
  Settings,
  SquareStack,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChatUiProvider, useChatUi } from "@/components/chat-ui-context";
import { NotificationBell } from "@/components/notification-bell";
import { SessionRail } from "@/components/session-rail";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { getWebState } from "@/server/actions.functions";

const navItems = [
  { to: "/sessions", label: "Sessions", icon: SquareStack },
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
      <div className="min-h-screen">
        <TopChrome />
        <main className="app-shell-main mx-auto min-h-screen w-full px-4 py-5 sm:px-8">
          {children}
        </main>
        {showRail ? <SessionRail /> : null}
      </div>
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
    void getWebState({ data: {} }).then((state) => {
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
    <header className="pointer-events-none fixed left-0 right-0 top-4 z-30 px-4 sm:px-8">
      <div className="app-shell-main mx-auto flex w-full items-start justify-end gap-3">
        <nav
          className="pointer-events-auto relative"
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
          <motion.div
            layout
            transition={transition}
            className="relative overflow-visible"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {expanded ? (
                <motion.div
                  key="expanded"
                  layout
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={transition}
                  className="absolute right-0 top-0 flex w-64 origin-top-right flex-col gap-1 rounded-3xl border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.96)] p-2 shadow-xl shadow-black/10 backdrop-blur-xl"
                >
                  <Link
                    to="/chat"
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors",
                      location.pathname === "/chat"
                        ? "bg-[rgb(var(--foreground))] text-[rgb(var(--background))]"
                        : "hover:bg-[rgb(var(--muted))]",
                    )}
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span className="whitespace-nowrap">New Chat</span>
                  </Link>
                  {lastActiveSessionId ? (
                    <Link
                      to="/chat/$sessionId"
                      params={{ sessionId: lastActiveSessionId }}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors",
                        location.pathname === `/chat/${lastActiveSessionId}`
                          ? "bg-[rgb(var(--foreground))] text-[rgb(var(--background))]"
                          : "hover:bg-[rgb(var(--muted))]",
                      )}
                    >
                      <MessagesSquare className="h-4 w-4" />
                      <span className="whitespace-nowrap">Active Chat</span>
                    </Link>
                  ) : (
                    <Link
                      to="/chat"
                      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors hover:bg-[rgb(var(--muted))]"
                    >
                      <MessagesSquare className="h-4 w-4" />
                      <span className="whitespace-nowrap">Active Chat</span>
                    </Link>
                  )}
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
                            ? "bg-[rgb(var(--foreground))] text-[rgb(var(--background))]"
                            : "hover:bg-[rgb(var(--muted))]",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="whitespace-nowrap">{item.label}</span>
                      </Link>
                    );
                  })}
                </motion.div>
              ) : (
                <motion.button
                  key="collapsed"
                  layout
                  type="button"
                  aria-label="Open menu"
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={transition}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.9)] text-[rgb(var(--muted-foreground))] shadow-lg shadow-black/5 backdrop-blur-xl transition-colors hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
                >
                  <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} />
                </motion.button>
              )}
            </AnimatePresence>
          </motion.div>
        </nav>
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.9)] p-1 shadow-lg shadow-black/5 backdrop-blur-xl">
          <NotificationBell />
          <ThemeToggle />
          {showDetails ? <DetailsToggle /> : null}
        </div>
      </div>
    </header>
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
