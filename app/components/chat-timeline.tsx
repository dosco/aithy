import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import { AsciiSplash } from "@/components/ascii-splash";
import {
  displayToolName,
  TimelineItem,
  TypingIndicator,
  type TimelineEntry,
} from "@/components/chat-timeline-entry";
import type { SessionSummaryDto } from "@/server/dto";
import type { SerializableBotMessage, SerializableSystemPermissionRequest, WebLiveEvent } from "../../src/web/live-events";

type ActivityEvent = Extract<WebLiveEvent, { type: "activity" }>;

export interface ChatMessageItem {
  id: number | string;
  message: SerializableBotMessage;
}

const ESTIMATED_ROW_HEIGHT = 132;
const OVERSCAN_PX = 800;
const BOTTOM_STICKINESS_PX = 180;
const TOP_LOAD_PX = 260;
const VIRTUALIZE_AFTER_ITEMS = 60;

export function ChatTimeline({
  messages,
  subSessions,
  activities,
  permissionRequests,
  details,
  sending,
  resetKey,
  hasMoreBefore,
  loadingMore,
  onLoadMore,
  onOpenSession,
  onPermissionDecision,
  onPermissionRetry,
}: {
  messages: ChatMessageItem[];
  subSessions: SessionSummaryDto[];
  activities: ActivityEvent[];
  permissionRequests: SerializableSystemPermissionRequest[];
  details: boolean;
  sending: boolean;
  resetKey: string | null;
  hasMoreBefore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<boolean>;
  onOpenSession: (session: SessionSummaryDto) => void;
  onPermissionDecision: (requestId: string, decision: "allow" | "deny", persist?: string) => void;
  onPermissionRetry: (message: Extract<SerializableBotMessage, { kind: "permission" }>) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const rowHeights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState(() => currentViewport());
  const [heightVersion, setHeightVersion] = useState(0);
  const timeline = useMemo(
    () => buildTimeline(messages, subSessions, activities, permissionRequests, details, sending),
    [messages, subSessions, activities, permissionRequests, details, sending],
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
    <div ref={listRef} className="app-chat-message-list flex flex-col gap-4">
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
              : (
                  <TimelineItem
                    item={item}
                    onOpenSession={onOpenSession}
                    onPermissionDecision={onPermissionDecision}
                    onPermissionRetry={onPermissionRetry}
                  />
                )}
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
    if ((message.kind === "text" || message.kind === "tool_call") && message.thought) count += 1;
    if (message.kind === "tool_call") count += 1;
    if ((message.kind === "text" || message.kind === "tool_call") && message.usage) count += 1;
  }
  return count;
}

function buildTimeline(
  messages: ChatMessageItem[],
  subSessions: SessionSummaryDto[],
  activities: ActivityEvent[],
  permissionRequests: SerializableSystemPermissionRequest[],
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
    if (details && (message.kind === "text" || message.kind === "tool_call") && message.thought && message.thought.trim().length > 0) {
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
    } else if (message.kind === "permission") {
      entries.push({
        at,
        entry: { kind: "permission", key: baseKey, message },
      });
    } else if (message.kind === "artifact") {
      entries.push({ at, entry: { kind: "artifact", key: baseKey, message } });
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
  permissionRequests.forEach((request) => {
    entries.push({
      at: request.createdAt,
      entry: { kind: "permission-request", key: `permission-${request.id}`, request },
    });
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
