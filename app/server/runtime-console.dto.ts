import type { JsonValue } from "../../src/web/live-events";
import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import type {
  RuntimeCommandRow,
  RuntimeCommandStatus,
} from "../../src/runtime/runtime-store";
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

export interface RuntimeConsoleDto {
  services: RuntimeServiceDto[];
  logs: RuntimeLogDto[];
  commands: RuntimeCommandDto[];
  queues: RuntimeQueueStatus[];
}

export async function runtimeConsoleDto(runtime: AithyRuntime): Promise<RuntimeConsoleDto> {
  const snapshot = await runtime.queue.consoleSnapshot({ logLimit: 120, commandLimit: 120 });
  return runtimeConsoleSnapshotDto(snapshot);
}

function runtimeConsoleSnapshotDto(snapshot: RuntimeConsoleSnapshot): RuntimeConsoleDto {
  return {
    services: snapshot.services.map(runtimeServiceDto),
    logs: snapshot.logs.flatMap(runtimeLogDto),
    commands: snapshot.commands.map(runtimeCommandDto),
    queues: snapshot.queues,
  };
}

function runtimeServiceDto(service: RuntimeServiceStatus): RuntimeServiceDto {
  return {
    ...service,
    detail: serializableDetail(service.detail),
  };
}

function runtimeLogDto(row: RuntimeConsoleSnapshot["logs"][number]): RuntimeLogDto[] {
  const payload = row.event;
  if (payload.type !== "log") return [];
  return [{
    id: row.id,
    createdAt: row.createdAt,
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
