import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { GitBranch } from "lucide-react";
import { AsciiSplash } from "@/components/ascii-splash";
import { Markdown } from "@/components/markdown";
import type { SessionSummaryDto } from "@/server/dto";
import type {
  SerializableBotMessage,
  WebLiveEvent,
} from "../../src/web/live-events";

type ActivityEvent = Extract<WebLiveEvent, { type: "activity" }>;
type Usage = { input: number; output: number; thought: number; total: number };

export interface ChatMessageItem {
  id: number | string;
  message: SerializableBotMessage;
}

type TimelineEntry =
  | { kind: "user"; key: string; content: string }
  | { kind: "assistant"; key: string; content: string; usage?: Usage }
  | { kind: "thought"; key: string; content: string }
  | { kind: "tool"; key: string; toolName: string; toolArgs: unknown; toolResult?: unknown; usage?: Usage }
  | { kind: "sub-session"; key: string; session: SessionSummaryDto }
  | { kind: "activity"; key: string; label: string }
  | { kind: "typing"; key: string };

const ESTIMATED_ROW_HEIGHT = 132;
const OVERSCAN_PX = 800;
const BOTTOM_STICKINESS_PX = 180;
const TOP_LOAD_PX = 260;
const VIRTUALIZE_AFTER_ITEMS = 60;

export function ChatTimeline({
  messages,
  subSessions,
  activities,
  details,
  sending,
  resetKey,
  hasMoreBefore,
  loadingMore,
  onLoadMore,
  onOpenSession,
}: {
  messages: ChatMessageItem[];
  subSessions: SessionSummaryDto[];
  activities: ActivityEvent[];
  details: boolean;
  sending: boolean;
  resetKey: string | null;
  hasMoreBefore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<boolean>;
  onOpenSession: (session: SessionSummaryDto) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const rowHeights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState(() => currentViewport());
  const [heightVersion, setHeightVersion] = useState(0);
  const timeline = useMemo(
    () => buildTimeline(messages, subSessions, activities, details, sending),
    [messages, subSessions, activities, details, sending],
  );

  useEffect(() => {
    rowHeights.current.clear();
    wasNearBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom());
  }, [resetKey]);

  useEffect(() => {
    if (!wasNearBottomRef.current) return;
    requestAnimationFrame(() => scrollToBottom());
  }, [timeline.length]);

  useEffect(() => {
    function update() {
      wasNearBottomRef.current = isNearBottom();
      setViewport(currentViewport());
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!hasMoreBefore || loadingMore) return;
    const list = listRef.current;
    if (!list) return;
    const listTop = list.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > listTop + TOP_LOAD_PX) return;
    const beforeHeight = document.documentElement.scrollHeight;
    const beforeY = window.scrollY;
    void onLoadMore().then((loaded) => {
      if (!loaded) return;
      requestAnimationFrame(() => {
        const delta = document.documentElement.scrollHeight - beforeHeight;
        window.scrollTo({ top: beforeY + delta });
      });
    });
  }, [hasMoreBefore, loadingMore, onLoadMore, viewport.scrollY]);

  const virtual = useMemo(
    () => virtualWindow(timeline, rowHeights.current, viewport, listRef.current),
    [timeline, viewport, heightVersion],
  );
  const shouldVirtualize = timeline.length > VIRTUALIZE_AFTER_ITEMS;
  const renderedItems = shouldVirtualize ? virtual.items : timeline;

  const recordHeight = useCallback((key: string, height: number) => {
    const previous = rowHeights.current.get(key);
    if (previous && Math.abs(previous - height) < 1) return;
    rowHeights.current.set(key, height);
    setHeightVersion((value) => value + 1);
  }, []);

  if (timeline.length === 0) {
    return (
      <div className="grid flex-1 place-items-center">
        <AsciiSplash />
      </div>
    );
  }

  return (
    <div ref={listRef} className="app-chat-message-list flex flex-col gap-5">
      {hasMoreBefore ? (
        <div className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
          {loadingMore ? "Loading history" : "Scroll up for history"}
        </div>
      ) : null}
      {shouldVirtualize ? <div style={{ height: virtual.top }} aria-hidden /> : null}
      <AnimatePresence initial={false}>
        {renderedItems.map((item) => (
          <MeasuredRow key={item.key} itemKey={item.key} onHeight={recordHeight}>
            {item.kind === "typing"
              ? <TypingIndicator />
              : <TimelineItem item={item} onOpenSession={onOpenSession} />}
          </MeasuredRow>
        ))}
      </AnimatePresence>
      {shouldVirtualize ? <div style={{ height: virtual.bottom }} aria-hidden /> : null}
    </div>
  );
}

export function countDebugItems(
  messages: ChatMessageItem[],
  activities: ActivityEvent[],
): number {
  let count = activities.length;
  for (const { message } of messages) {
    if (message.role !== "assistant") continue;
    if (message.thought) count += 1;
    if (message.kind === "tool_call") count += 1;
    if (message.usage) count += 1;
  }
  return count;
}

function buildTimeline(
  messages: ChatMessageItem[],
  subSessions: SessionSummaryDto[],
  activities: ActivityEvent[],
  details: boolean,
  sending: boolean,
): TimelineEntry[] {
  const entries: Array<{ at: string; entry: TimelineEntry }> = [];
  messages.forEach(({ id, message }) => {
    const at = message.createdAt;
    const baseKey = String(id);
    if (message.role === "user") {
      if (message.content.trim().length > 0) {
        entries.push({ at, entry: { kind: "user", key: baseKey, content: message.content } });
      }
      return;
    }
    if (details && message.thought && message.thought.trim().length > 0) {
      entries.push({ at, entry: { kind: "thought", key: `${baseKey}-thought`, content: message.thought } });
    }
    if (message.kind === "text") {
      if (message.content.trim().length > 0 || (details && message.usage)) {
        entries.push({
          at,
          entry: {
            kind: "assistant",
            key: baseKey,
            content: message.content,
            usage: details ? message.usage : undefined,
          },
        });
      }
    } else if (details) {
      entries.push({
        at,
        entry: {
          kind: "tool",
          key: baseKey,
          toolName: displayToolName(message.toolName, message.toolArgs),
          toolArgs: message.toolArgs,
          toolResult: message.toolResult,
          usage: message.usage,
        },
      });
    }
  });
  subSessions.forEach((session) => {
    entries.push({
      at: session.createdAt,
      entry: {
        kind: "sub-session",
        key: `sub-session-${session.conversationId}`,
        session,
      },
    });
  });
  if (details) {
    activities.forEach((event) => {
      entries.push({
        at: event.createdAt,
        entry: { kind: "activity", key: event.id, label: event.label },
      });
    });
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out = entries.map((item) => item.entry);
  if (sending) out.push({ kind: "typing", key: "__typing__" });
  return out;
}

function virtualWindow(
  entries: TimelineEntry[],
  heights: Map<string, number>,
  viewport: { scrollY: number; height: number },
  list: HTMLDivElement | null,
): { items: TimelineEntry[]; top: number; bottom: number } {
  const listTop = list ? list.getBoundingClientRect().top + window.scrollY : 0;
  const startY = Math.max(0, viewport.scrollY - listTop - OVERSCAN_PX);
  const endY = Math.max(startY, viewport.scrollY - listTop + viewport.height + OVERSCAN_PX);
  let y = 0;
  let start = 0;
  let end = entries.length;
  for (let i = 0; i < entries.length; i += 1) {
    const height = heights.get(entries[i].key) ?? ESTIMATED_ROW_HEIGHT;
    if (y + height < startY) start = i + 1;
    if (y <= endY) end = i + 1;
    y += height;
  }
  const top = sumHeights(entries.slice(0, start), heights);
  const visible = entries.slice(start, Math.max(start, end));
  const bottom = Math.max(0, y - top - sumHeights(visible, heights));
  return { items: visible, top, bottom };
}

function sumHeights(entries: TimelineEntry[], heights: Map<string, number>): number {
  return entries.reduce((total, entry) => total + (heights.get(entry.key) ?? ESTIMATED_ROW_HEIGHT), 0);
}

function MeasuredRow({
  itemKey,
  children,
  onHeight,
}: {
  itemKey: string;
  children: ReactNode;
  onHeight: (key: string, height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => onHeight(itemKey, node.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [itemKey, onHeight]);
  return <div ref={ref}>{children}</div>;
}

function TimelineItem({
  item,
  onOpenSession,
}: {
  item: Exclude<TimelineEntry, { kind: "typing" }>;
  onOpenSession: (session: SessionSummaryDto) => void;
}) {
  const reduce = useReducedMotion();
  const motionProps = reduce
    ? {}
    : {
        layout: true,
        initial: { opacity: 0, y: 8, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, transition: { duration: 0.12 } },
        transition: { type: "spring" as const, stiffness: 380, damping: 30 },
      };
  if (item.kind === "user") {
    return (
      <motion.div
        {...motionProps}
        className="app-chat-bubble app-chat-bubble-user ml-auto w-fit max-w-[min(68%,42rem)] rounded-[20px] rounded-br-md bg-[rgb(var(--accent))] px-5 py-3 text-base leading-relaxed text-[rgb(var(--accent-foreground))]"
      >
        <Markdown text={item.content} />
      </motion.div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <motion.div {...motionProps} className="app-chat-bubble-frame w-fit max-w-[min(72%,46rem)]">
        <div className="app-chat-bubble app-chat-bubble-assistant rounded-[20px] rounded-bl-md bg-[rgb(var(--bubble-bot))] px-5 py-3 text-base leading-relaxed">
          <Markdown text={item.content} />
        </div>
        {item.usage ? <UsageLine usage={item.usage} /> : null}
      </motion.div>
    );
  }
  if (item.kind === "thought") {
    return (
      <motion.div
        {...motionProps}
        className="app-chat-bubble-frame w-fit max-w-[min(72%,46rem)] rounded-[20px] border border-dashed border-[rgb(var(--border))] px-5 py-3 text-sm leading-relaxed text-[rgb(var(--muted-foreground))] [overflow-wrap:anywhere]"
      >
        <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.2em]">thinking</span>
        <span className="italic whitespace-pre-wrap">{item.content}</span>
      </motion.div>
    );
  }
  if (item.kind === "tool") {
    return (
      <motion.div
        {...motionProps}
        className="app-chat-bubble-frame w-fit max-w-[min(72%,46rem)] rounded-[20px] bg-[rgb(var(--muted))] px-4 py-3 font-mono text-xs leading-relaxed text-[rgb(var(--muted-foreground))]"
      >
        <div className="mb-1 font-sans text-[10px] uppercase tracking-[0.2em]">tool · {item.toolName}</div>
        <div className="overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(item.toolArgs, null, 2)}
        </div>
        {item.toolResult === undefined ? null : (
          <>
            <div className="mb-1 mt-3 font-sans text-[10px] uppercase tracking-[0.2em]">result</div>
            <div className="overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(item.toolResult, null, 2)}
            </div>
          </>
        )}
        {item.usage ? <UsageLine usage={item.usage} /> : null}
      </motion.div>
    );
  }
  if (item.kind === "sub-session") {
    return (
      <motion.div
        {...motionProps}
        className="app-chat-bubble-frame flex w-fit max-w-[min(72%,46rem)] items-center gap-3 rounded-[20px] border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3 py-2 shadow-sm"
      >
        <button
          type="button"
          onClick={() => onOpenSession(item.session)}
          aria-label={`Open sub-session ${item.session.name}`}
          title="Open sub-session"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[rgb(var(--accent))] text-[rgb(var(--accent-foreground))] transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))] focus:ring-offset-2 focus:ring-offset-[rgb(var(--background))]"
        >
          <GitBranch className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => onOpenSession(item.session)}
          className="min-w-0 text-left"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
            sub-session
          </div>
          <div className="truncate text-sm font-medium">{item.session.name}</div>
        </button>
      </motion.div>
    );
  }
  return (
    <motion.div
      {...motionProps}
      className="app-chat-bubble-frame max-w-[72%] font-mono text-xs text-[rgb(var(--muted-foreground))]"
    >
      · {item.label}
    </motion.div>
  );
}

function TypingIndicator() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-1.5 px-2"
      aria-label="Assistant is thinking"
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block h-2 w-2 rounded-full bg-[rgb(var(--accent))]"
          animate={reduce ? undefined : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={
            reduce
              ? undefined
              : { duration: 1, ease: "easeInOut", repeat: Infinity, delay: i * 0.15 }
          }
        />
      ))}
    </motion.div>
  );
}

function UsageLine({ usage }: { usage: Usage }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
      <span>in {usage.input}</span>
      <span>out {usage.output}</span>
      {usage.thought ? <span>thought {usage.thought}</span> : null}
      <span>· {usage.total} total</span>
    </div>
  );
}

function displayToolName(toolName: string | undefined, toolArgs: unknown): string {
  if (toolName?.trim()) return toolName;
  if (hasKeys(toolArgs, ["query", "task"])) return "web.search";
  if (hasKeys(toolArgs, ["url"])) return "web.fetch";
  if (hasKeys(toolArgs, ["queries", "excludeIds"])) return "memory.recall";
  if (hasKeys(toolArgs, ["queries"])) return "skills.search";
  if (hasKeys(toolArgs, ["command"])) return "sandbox.bash";
  return "unknown";
}

function hasKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  return keys.every((key) => key in value);
}

function currentViewport(): { scrollY: number; height: number } {
  if (typeof window === "undefined") return { scrollY: 0, height: 900 };
  return { scrollY: window.scrollY, height: window.innerHeight };
}

function isNearBottom(): boolean {
  const doc = document.documentElement;
  return doc.scrollHeight - (window.scrollY + window.innerHeight) < BOTTOM_STICKINESS_PX;
}

function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight });
}
