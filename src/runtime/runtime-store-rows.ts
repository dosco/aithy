import type { Database } from "bun:sqlite";
import type { WebLiveEvent } from "../web/live-events";
import type { CommandCompletion, RuntimeServiceRole, RuntimeServiceState, RuntimeServiceStatus } from "./protocol/types";
import type { RuntimeCommandRow, RuntimeCommandStatus, RuntimeEventRow } from "./runtime-store-types";

export interface CommandDbRow {
  id: string;
  target_role: RuntimeServiceRole;
  kind: string;
  payload_json: string;
  status: RuntimeCommandStatus;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  detail_json: string | null;
}

export interface ServiceDbRow {
  role: RuntimeServiceRole;
  pid: number | null;
  status: RuntimeServiceState;
  last_seen_at: string;
  detail_json: string | null;
}

export function eventRow(row: {
  id: number;
  kind: string;
  conversation_id: string | null;
  stream_id: string | null;
  payload_json: string;
  created_at: string;
}): RuntimeEventRow {
  return {
    id: row.id,
    kind: row.kind,
    conversationId: row.conversation_id,
    streamId: row.stream_id,
    payload: JSON.parse(row.payload_json) as WebLiveEvent,
    createdAt: row.created_at,
  };
}

export function commandRow(row: CommandDbRow): RuntimeCommandRow {
  return {
    id: row.id,
    targetRole: row.target_role,
    kind: row.kind,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    detail: parseJson(row.detail_json),
  };
}

export function serviceRow(row: ServiceDbRow): RuntimeServiceStatus {
  return {
    role: row.role,
    state: row.status,
    pid: row.pid,
    detail: parseJson(row.detail_json),
    lastSeenAt: row.last_seen_at,
  };
}

export function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function isCommandCompletion(value: unknown): value is CommandCompletion {
  return Boolean(
    value
    && typeof value === "object"
    && "ok" in value
    && typeof (value as { ok: unknown }).ok === "boolean",
  );
}

export function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}
