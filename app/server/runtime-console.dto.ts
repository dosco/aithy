import type { JsonValue, WebLiveEvent } from "../../src/web/live-events";
import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { loadBaseConfig } from "../../src/runtime/resolve-effective-config";
import type {
  RuntimeCommandRow,
  RuntimeCommandStatus,
} from "../../src/runtime/runtime-store";
import { RuntimeStore } from "../../src/runtime/runtime-store";
import type { RuntimeConsoleSnapshot } from "../../src/runtime/protocol/bus";
import type {
  RuntimeLogEventPayload,
  RuntimeQueueStatus,
  RuntimeServiceRole,
  RuntimeServiceState,
  RuntimeServiceStatus,
} from "../../src/runtime/protocol/types";

export interface RuntimeLogDto extends Omit<RuntimeLogEventPayload, "detail"> {
  id: number | string;
  createdAt: string;
  detail?: JsonValue;
}

export interface RuntimeServiceDto {
  role: RuntimeServiceRole;
  state: RuntimeServiceState;
  pid: number | null;
  detail: JsonValue | null;
  lastSeenAt: string;
}

export interface RuntimeCommandDto {
  id: string;
  targetRole: RuntimeServiceRole;
  kind: string;
  status: RuntimeCommandStatus;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  detail: JsonValue | null;
}

export type RuntimeSetupStatusDto = Extract<WebLiveEvent, { type: "setup-status" }>;

export interface RuntimeConsoleDto {
  services: RuntimeServiceDto[];
  setupStatuses: RuntimeSetupStatusDto[];
  logs: RuntimeLogDto[];
  commands: RuntimeCommandDto[];
  queues: RuntimeQueueStatus[];
  snapshotState?: "live" | "stale";
  snapshotError?: string;
  refreshedAt?: string;
}

export async function runtimeConsoleDto(
  runtime: AithyRuntime,
  input: { logLimit?: number; commandLimit?: number } = {},
): Promise<RuntimeConsoleDto> {
  const snapshot = await runtime.queue.consoleSnapshot({
    logLimit: input.logLimit ?? 120,
    commandLimit: input.commandLimit ?? 120,
  });
  return {
    ...runtimeConsoleSnapshotDto(snapshot),
    snapshotState: "live",
    refreshedAt: new Date().toISOString(),
  };
}

export function staleRuntimeConsoleDto(
  error: unknown,
  input: { logLimit?: number; commandLimit?: number } = {},
): RuntimeConsoleDto {
  const store = new RuntimeStore(loadBaseConfig().stateDbPath);
  try {
    const message = errorMessage(error);
    const refreshedAt = new Date().toISOString();
    return {
      services: store.services().map(runtimeServiceDto),
      setupStatuses: recentSetupStatuses(store),
      logs: [
        {
          id: "console-stale",
          createdAt: refreshedAt,
          role: "web",
          level: "warn",
          source: "console",
          message: `Runtime console is showing the last persisted state: ${message}`,
        },
        ...store.recentEvents({ kinds: ["log"], limit: input.logLimit ?? 120 }).flatMap(runtimeLogEventDto),
      ],
      commands: store.recentCommands(input.commandLimit ?? 120).map(runtimeCommandDto),
      queues: recentQueues(store),
      snapshotState: "stale",
      snapshotError: message,
      refreshedAt,
    };
  } finally {
    store.close();
  }
}

function runtimeConsoleSnapshotDto(snapshot: RuntimeConsoleSnapshot): RuntimeConsoleDto {
  return {
    services: snapshot.services.map(runtimeServiceDto),
    setupStatuses: snapshot.setupStatuses,
    logs: snapshot.logs.flatMap(runtimeLogDto),
    commands: snapshot.commands.map(runtimeCommandDto),
    queues: snapshot.queues,
  };
}

function recentSetupStatuses(store: RuntimeStore): RuntimeSetupStatusDto[] {
  const latest = new Map<string, RuntimeSetupStatusDto>();
  const rows = store.recentEvents({ kinds: ["setup-status"], limit: 100 }).reverse();
  for (const row of rows) {
    const event = row.payload;
    if (event.type !== "setup-status") continue;
    if (event.active || event.tone === "danger") latest.set(event.key, event);
    else latest.delete(event.key);
  }
  return [...latest.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function recentQueues(store: RuntimeStore): RuntimeQueueStatus[] {
  const queueById = new Map<string, RuntimeQueueStatus>();
  for (const row of store.recentEvents({ kinds: ["queue-status"], limit: 100 })) {
    if (row.payload.type === "queue-status" && !queueById.has(row.payload.queue.id)) {
      queueById.set(row.payload.queue.id, row.payload.queue);
    }
  }
  return [...queueById.values()];
}

function runtimeServiceDto(service: RuntimeServiceStatus): RuntimeServiceDto {
  return {
    ...service,
    detail: serializableDetail(service.detail),
  };
}

function runtimeLogDto(row: RuntimeConsoleSnapshot["logs"][number]): RuntimeLogDto[] {
  const payload = row.event;
  return runtimeLogPayloadDto(row.id, row.createdAt, payload);
}

function runtimeLogEventDto(row: ReturnType<RuntimeStore["recentEvents"]>[number]): RuntimeLogDto[] {
  return runtimeLogPayloadDto(row.id, row.createdAt, row.payload);
}

function runtimeLogPayloadDto(
  id: number | string,
  createdAt: string,
  payload: RuntimeConsoleSnapshot["logs"][number]["event"],
): RuntimeLogDto[] {
  if (payload.type !== "log") return [];
  return [{
    id,
    createdAt,
    role: payload.role,
    level: payload.level,
    source: payload.source,
    message: payload.message,
    detail: serializableDetail(payload.detail) ?? undefined,
  } satisfies RuntimeLogDto];
}

function runtimeCommandDto(row: RuntimeCommandRow): RuntimeCommandDto {
  return {
    id: row.id,
    targetRole: row.targetRole,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    completedAt: row.completedAt,
    detail: serializableDetail(row.detail),
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
