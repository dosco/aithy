import type { WebLiveEvent } from "../../src/web/live-events";

export type SetupStatusEvent = Extract<WebLiveEvent, { type: "setup-status" }>;
export type QueueStatusEvent = Extract<WebLiveEvent, { type: "queue-status" }>;

export function queueStatusToSetup(event: QueueStatusEvent): SetupStatusEvent {
  const queue = event.queue;
  const waiting = queue.blockedReason ?? (
    queue.depth && queue.depth > 0 ? `queued (${queue.depth} waiting)` : "chat queue idle"
  );
  const active = queue.state === "blocked" || queue.state === "running";
  return {
    type: "setup-status",
    id: event.id,
    createdAt: event.createdAt,
    key: "agent.dispatcher",
    label: waiting,
    active,
    tone: queue.state === "failed" ? "danger" : active ? "neutral" : "neutral",
  };
}

export function sessionIdFromPath(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function appendSetupStatus(
  current: SetupStatusEvent[],
  event: SetupStatusEvent,
): SetupStatusEvent[] {
  return compactSetupStatuses([...current, event]);
}

export function compactSetupStatuses(current: SetupStatusEvent[]): SetupStatusEvent[] {
  const byKey = new Map<string, SetupStatusEvent>();
  for (const event of current) {
    const key = event.key ?? event.id;
    if (event.key === "agent" && !event.active) {
      byKey.delete(key);
      continue;
    }
    if (event.key === "agent.dispatcher" && !event.active) {
      byKey.delete(key);
      continue;
    }
    if (!event.active && event.tone !== "danger" && event.tone !== "success") {
      byKey.delete(key);
      continue;
    }
    byKey.set(key, event);
  }
  return [...byKey.values()].slice(-8);
}
