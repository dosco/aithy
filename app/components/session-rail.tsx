import { useNavigate, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getWebState } from "@/server/actions.functions";
import type { SessionSummaryDto } from "@/server/dto";
import { cn } from "@/lib/utils";
import type { WebLiveEvent } from "../../src/web/live-events";

const RAIL_WIDTH = 288;

export function SessionRail() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { sessionId?: string };
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummaryDto[]>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getWebState({ data: {} }).then((state) => {
      if (!cancelled) setSessions(state.sessions);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WebLiveEvent | { type: "connected" };
      if (event.type === "sessions") setSessions(event.sessions);
    };
    return () => source.close();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function show() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }
  function hideSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 400);
  }

  function pick(id: string) {
    setOpen(false);
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  }

  function startNew() {
    setOpen(false);
    void navigate({ to: "/chat" });
  }

  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const transition = reduce
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 320, damping: 34 };

  return (
    <>
      <button
        type="button"
        aria-label="Open session switcher"
        onMouseEnter={show}
        onClick={show}
        className="group fixed right-0 top-1/2 z-20 flex h-24 w-3 -translate-y-1/2 cursor-pointer items-center justify-center"
      >
        <span
          className={cn(
            "h-12 w-1 rounded-full bg-[rgb(var(--border))] transition-all duration-200",
            "group-hover:w-1.5 group-hover:bg-[rgb(var(--muted-foreground))]",
            open && "opacity-0",
          )}
        />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.aside
            key="rail"
            initial={reduce ? { x: 0 } : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduce ? { x: "100%" } : { x: "100%" }}
            transition={transition}
            onMouseEnter={show}
            onMouseLeave={hideSoon}
            style={{ width: RAIL_WIDTH }}
            className="fixed right-0 top-0 z-20 flex h-screen flex-col border-l border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-2xl shadow-black/10"
            aria-label="Session switcher"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border)/0.6)] px-4 pb-3 pt-20">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
                Sessions
              </p>
              <button
                type="button"
                onClick={startNew}
                aria-label="New session"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent))] text-[rgb(var(--accent-foreground))] transition hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 pt-1">
              {sessions.length === 0 ? (
                <div className="px-2 py-4 text-sm text-[rgb(var(--muted-foreground))]">
                  No sessions yet.
                </div>
              ) : (
                <div className="flex flex-col">
                  {GROUP_ORDER.map((groupKey) => {
                    const items = groups[groupKey];
                    if (items.length === 0) return null;
                    return (
                      <section key={groupKey} className="flex flex-col">
                        <h3 className="px-1 pb-1.5 pt-3 font-mono text-[9px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground)/0.7)]">
                          {GROUP_LABELS[groupKey]}
                        </h3>
                        <div className="flex flex-col gap-0.5">
                          {items.map((session) => {
                            const active = session.conversationId === params.sessionId;
                            return (
                              <motion.button
                                key={session.conversationId}
                                type="button"
                                onClick={() => pick(session.conversationId)}
                                whileTap={reduce ? undefined : { scale: 0.98 }}
                                className={cn(
                                  "relative flex w-full shrink-0 cursor-pointer items-start justify-between gap-2 rounded-[10px] px-3 py-2 text-left transition-colors",
                                  active
                                    ? "bg-[rgb(var(--muted))]"
                                    : "hover:bg-[rgb(var(--muted)/0.6)]",
                                )}
                              >
                                {active ? (
                                  <span
                                    aria-hidden
                                    className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full bg-[rgb(var(--accent))]"
                                  />
                                ) : null}
                                <span className="line-clamp-2 text-xs leading-snug">{session.name}</span>
                                <span className="shrink-0 pt-px font-mono text-[10px] tracking-[0.04em] text-[rgb(var(--muted-foreground))]">
                                  {formatRelativeTime(session.updatedAt)}
                                </span>
                              </motion.button>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );
}

type GroupKey = "today" | "week" | "older";

const GROUP_ORDER: GroupKey[] = ["today", "week", "older"];
const GROUP_LABELS: Record<GroupKey, string> = {
  today: "Today",
  week: "This week",
  older: "Older",
};

function groupSessions(sessions: SessionSummaryDto[]): Record<GroupKey, SessionSummaryDto[]> {
  const now = Date.now();
  const buckets: Record<GroupKey, SessionSummaryDto[]> = { today: [], week: [], older: [] };
  const sorted = [...sessions].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
  for (const session of sorted) {
    const age = now - new Date(session.updatedAt).getTime();
    if (age < 24 * 60 * 60 * 1000) buckets.today.push(session);
    else if (age < 7 * 24 * 60 * 60 * 1000) buckets.week.push(session);
    else buckets.older.push(session);
  }
  return buckets;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - then.getTime();
  if (diff < 60 * 1000) return "now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))}d`;
  if (then.getFullYear() === now.getFullYear()) {
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return then.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
