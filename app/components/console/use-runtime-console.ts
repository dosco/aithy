import { useEffect, useState } from "react";
import { useLiveEvent } from "@/components/live-events";
import { getRuntimeConsole } from "@/server/console.functions";
import type { RuntimeConsoleDto, RuntimeLogDto } from "@/server/runtime-console.dto";
import type { JsonValue, WebLiveEvent } from "../../../src/web/live-events";

export interface RuntimeConsoleLimits {
  logLimit: number;
  commandLimit: number;
}

export function useRuntimeConsole(
  initial?: RuntimeConsoleDto,
  limits: RuntimeConsoleLimits = { logLimit: 120, commandLimit: 120 },
) {
  const [state, setState] = useState<RuntimeConsoleDto>(
    initial ?? { services: [], logs: [], commands: [], queues: [] },
  );

  useEffect(() => {
    if (initial && limits.logLimit === 120 && limits.commandLimit === 120) return;
    void getRuntimeConsole({ data: limits }).then(setState);
  }, [initial, limits.logLimit, limits.commandLimit]);

  useLiveEvent((event) => {
    if (event.type === "log") {
      setState((current) => ({
        ...current,
        logs: [liveLog(event), ...current.logs].slice(0, limits.logLimit),
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
  }, [limits.logLimit]);

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
