import { useEffect, useState } from "react";
import { getRuntimeConsole } from "@/server/console.functions";
import type { RuntimeConsoleDto, RuntimeLogDto } from "@/server/runtime-console.dto";
import type { JsonValue, WebLiveEvent } from "../../../src/web/live-events";

export function useRuntimeConsole(initial?: RuntimeConsoleDto) {
  const [state, setState] = useState<RuntimeConsoleDto>(
    initial ?? { services: [], logs: [], commands: [], queues: [] },
  );

  useEffect(() => {
    if (initial) return;
    void getRuntimeConsole({ data: {} }).then(setState);
  }, [initial]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as WebLiveEvent | { type: "connected" };
      if (event.type === "log") {
        setState((current) => ({
          ...current,
          logs: [liveLog(event), ...current.logs].slice(0, 120),
        }));
      }
      if (event.type === "service-status") {
        setState((current) => ({
          ...current,
          services: upsertBy(current.services, event.role, {
            role: event.role,
            state: event.state,
            pid: event.pid,
            detail: serializableDetail(event.detail),
            lastSeenAt: event.lastSeenAt,
          }),
        }));
      }
      if (event.type === "queue-status") {
        setState((current) => ({
          ...current,
          queues: upsertBy(current.queues, event.queue.id, event.queue),
        }));
      }
    };
    return () => source.close();
  }, []);

  return state;
}

function liveLog(event: Extract<WebLiveEvent, { type: "log" }>): RuntimeLogDto {
  return {
    id: event.id,
    createdAt: event.createdAt,
    role: event.role,
    level: event.level,
    source: event.source,
    message: event.message,
    detail: serializableDetail(event.detail) ?? undefined,
  };
}

function serializableDetail(value: unknown): JsonValue | null {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function upsertBy<T>(items: T[], key: string, next: T): T[] {
  const index = items.findIndex((item) => itemKey(item) === key);
  if (index === -1) return [next, ...items];
  return items.map((item, i) => (i === index ? next : item));
}

function itemKey(item: unknown): string {
  const value = item as { id?: string; role?: string };
  return value.id ?? value.role ?? "";
}
