import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import { AsciiSplash } from "@/components/ascii-splash";
import {
  displayToolName,
  TimelineItem,
  WorkingIndicator,
  type TimelineEntry,
} from "@/components/chat-timeline-entry";
import { deriveWorkingLabel } from "@/components/chat-working-status";
import type { SessionSummaryDto, TaskDto } from "@/server/dto";
import type { LayoutName } from "../../src/settings/types";
import type { SerializableBotMessage, SerializableSystemPermissionRequest, WebLiveEvent } from "../../src/web/live-events";
import type { LocalChatTurnPhase } from "./chat-turn-model";
import type { StreamingDraft } from "./streaming-draft";

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
  streamingDraft,
  tasks,
  subSessions,
  activities,
  permissionRequests,
  retryableTasks,
  retryingTaskIds,
  details,
  sending,
  localTurnPhase,
  layout,
  retryDisabled,
  resetKey,
  hasMoreBefore,
  loadingMore,
  onLoadMore,
  onOpenSession,
  onPermissionDecision,
  onPermissionRetry,
  onRetryTask,
  onClarificationSubmit,
}: {
  messages: ChatMessageItem[];
  streamingDraft: StreamingDraft | null;
  tasks: TaskDto[];
  subSessions: SessionSummaryDto[];
  activities: ActivityEvent[];
  permissionRequests: SerializableSystemPermissionRequest[];
  retryableTasks: TaskDto[];
  retryingTaskIds: Set<string>;
  details: boolean;
  sending: boolean;
  localTurnPhase: LocalChatTurnPhase;
  layout: LayoutName;
  retryDisabled: boolean;
  resetKey: string | null;
  hasMoreBefore: boolean;
  loadingMore: boolean;
  onLoadMore: () => Promise<boolean>;
  onOpenSession: (session: SessionSummaryDto) => void;
  onPermissionDecision: (requestId: string, decision: "allow" | "deny", persist?: string) => void;
  onPermissionRetry: (message: Extract<SerializableBotMessage, { kind: "permission" }>) => void;
  onRetryTask: (taskId: string) => void;
  onClarificationSubmit: (text: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);
  const rowHeights = useRef(new Map<string, number>());
  const [viewport, setViewport] = useState(() => currentViewport());
  const [heightVersion, setHeightVersion] = useState(0);
  const timeline = useMemo(
    () => buildTimeline({
      messages,
      streamingDraft,
      tasks,
      subSessions,
      activities,
      permissionRequests,
      retryableTasks,
      retryingTaskIds,
      retryDisabled,
      details,
      sending,
      localTurnPhase,
      sessionId: resetKey,
    }),
    [
      messages,
      streamingDraft,
      tasks,
      subSessions,
      activities,
      permissionRequests,
      retryableTasks,
      retryingTaskIds,
      retryDisabled,
      details,
      sending,
      localTurnPhase,
      resetKey,
    ],
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
              ? <WorkingIndicator label={item.label} detail={item.detail} />
              : (
                  <TimelineItem
                    item={item}
                    layout={layout}
                    onOpenSession={onOpenSession}
                    onPermissionDecision={onPermissionDecision}
                    onPermissionRetry={onPermissionRetry}
                    onRetryTask={onRetryTask}
                    onClarificationSubmit={onClarificationSubmit}
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

export function buildTimeline(input: {
  messages: ChatMessageItem[];
  streamingDraft?: StreamingDraft | null;
  tasks: TaskDto[];
  subSessions: SessionSummaryDto[];
  activities: ActivityEvent[];
  permissionRequests: SerializableSystemPermissionRequest[];
  retryableTasks: TaskDto[];
  retryingTaskIds: Set<string>;
  retryDisabled: boolean;
  details: boolean;
  sending: boolean;
  localTurnPhase?: LocalChatTurnPhase;
  sessionId?: string | null;
}): TimelineEntry[] {
  const entries: Array<{ at: string; entry: TimelineEntry }> = [];
  const messageDayKeys = new Set<string>();
  const addMessageEntry = (at: string, entry: TimelineEntry) => {
    entries.push({ at, entry });
    messageDayKeys.add(localDayKey(at));
  };
  const retryTaskIds = retryTaskIdsByAssistantKey(input.messages, input.retryableTasks);
  const latestAssistantTextId = [...input.messages]
    .reverse()
    .find(({ message }) => message.role === "assistant" && message.kind === "text")?.id;
  input.messages.forEach(({ id, message }) => {
    const at = message.createdAt;
    const baseKey = String(id);
    if (message.role === "user") {
      if (message.content.trim().length > 0) {
        addMessageEntry(at, { kind: "user", key: baseKey, content: message.content });
      }
      return;
    }
    if (input.details && (message.kind === "text" || message.kind === "tool_call") && message.thought && message.thought.trim().length > 0) {
      addMessageEntry(at, { kind: "thought", key: `${baseKey}-thought`, content: message.thought });
    }
    if (message.kind === "text") {
      if (message.content.trim().length > 0 || (input.details && message.usage)) {
        addMessageEntry(at, {
          kind: "assistant",
          key: baseKey,
          content: message.content,
          status: message.status,
          retryTaskId: retryTaskIds.get(baseKey),
          retrying: input.retryingTaskIds.has(retryTaskIds.get(baseKey) ?? ""),
          retryDisabled: input.retryDisabled,
          usage: input.details ? message.usage : undefined,
          clarification: message.clarification,
          clarificationInteractive: !input.sending
            && Boolean(message.clarification)
            && id === latestAssistantTextId,
          ...(input.sessionId && typeof id === "number" ? { feedback: { sessionId: input.sessionId, messageId: id } } : {}),
        });
      }
    } else if (message.kind === "permission") {
      addMessageEntry(at, { kind: "permission", key: baseKey, message });
    } else if (message.kind === "artifact") {
      addMessageEntry(at, { kind: "artifact", key: baseKey, message });
    } else if (input.details) {
      addMessageEntry(at, {
        kind: "tool",
        key: baseKey,
        toolName: displayToolName(message.toolName, message.toolArgs),
        toolArgs: message.toolArgs,
        toolResult: message.toolResult,
        usage: message.usage,
      });
    }
  });
  input.permissionRequests.forEach((request) => {
    entries.push({
      at: request.createdAt,
      entry: { kind: "permission-request", key: `permission-${request.id}`, request },
    });
  });
  input.subSessions.forEach((session) => {
    entries.push({
      at: session.createdAt,
      entry: {
        kind: "sub-session",
        key: `sub-session-${session.conversationId}`,
        session,
      },
    });
  });
  if (input.details) {
    input.activities.forEach((event) => {
      entries.push({
        at: event.createdAt,
        entry: { kind: "activity", key: event.id, label: event.label },
      });
    });
  }
  entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out = withDayDividers(entries, messageDayKeys);
  if (input.streamingDraft?.text) {
    out.push({
      kind: "assistant",
      key: `streaming-${input.streamingDraft.turnKey}`,
      content: input.streamingDraft.text,
    });
  }
  if (input.sending && !input.streamingDraft?.text) {
    out.push({
      kind: "typing",
      key: "__typing__",
      ...deriveWorkingLabel(input),
    });
  }
  return out;
}

function withDayDividers(
  entries: Array<{ at: string; entry: TimelineEntry }>,
  messageDayKeys: Set<string>,
): TimelineEntry[] {
  const seenDays = new Set<string>();
  const out: TimelineEntry[] = [];
  for (const item of entries) {
    const dayKey = localDayKey(item.at);
    if (!seenDays.has(dayKey)) {
      seenDays.add(dayKey);
      if (messageDayKeys.has(dayKey)) {
        out.push({
          kind: "day-divider",
          key: `day-${dayKey}`,
          label: formatDayDivider(item.at),
        });
      }
    }
    out.push(item.entry);
  }
  return out;
}

function localDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10) || "unknown";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDayDivider(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10) || "Unknown date";
  const now = new Date();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function retryTaskIdsByAssistantKey(
  messages: ChatMessageItem[],
  tasks: TaskDto[],
): Map<string, string> {
  const failedAssistants = messages
    .filter(({ message }) => message.role === "assistant" && message.kind === "text" && isFailedAssistant(message))
    .sort((a, b) => compareIso(a.message.createdAt, b.message.createdAt));
  const retryableTasks = tasks
    .filter((task) => task.canRetry && task.status === "failed" && task.kind === "chat.turn")
    .sort((a, b) => compareIso(a.createdAt, b.createdAt));
  const out = new Map<string, string>();
  let taskIndex = retryableTasks.length - 1;
  for (let messageIndex = failedAssistants.length - 1; messageIndex >= 0 && taskIndex >= 0; messageIndex -= 1) {
    out.set(String(failedAssistants[messageIndex].id), retryableTasks[taskIndex].id);
    taskIndex -= 1;
  }
  return out;
}

function isFailedAssistant(message: Extract<SerializableBotMessage, { role: "assistant"; kind: "text" }>): boolean {
  return message.status === "failed"
    || message.content.trim().startsWith("Error:")
    || message.content.trim() === "Unknown error";
}

function compareIso(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
