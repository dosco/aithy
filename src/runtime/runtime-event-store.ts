import type { Database } from "bun:sqlite";
import type { RuntimeLogEventPayload, RuntimeQueueStatus } from "./protocol/types";
import { eventRow } from "./runtime-store-rows";
import type { RuntimeEventPageInput, RuntimeEventRow } from "./runtime-store-types";
import type { WebLiveEvent } from "../web/live-events";

const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function appendEvent(db: Database, event: WebLiveEvent, expiresAt?: string | null): number {
  const row = db.query(`
    INSERT INTO runtime_events (kind, conversation_id, stream_id, payload_json, created_at, expires_at)
    VALUES ($kind, $conversationId, $streamId, $payload, $createdAt, $expiresAt)
    RETURNING id
  `).get({
    $kind: event.type,
    $conversationId: "conversationId" in event ? event.conversationId : null,
    $streamId: event.streamId ?? null,
    $payload: JSON.stringify(event),
    $createdAt: event.createdAt,
    $expiresAt: expiresAt ?? null,
  }) as { id: number };
  return row.id;
}

export function appendLog(db: Database, input: RuntimeLogEventPayload, expiresAt?: string | null): number {
  return appendEvent(
    db,
    {
      type: "log",
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...input,
    },
    expiresAt ?? new Date(Date.now() + LOG_RETENTION_MS).toISOString(),
  );
}

export function appendQueueStatus(db: Database, queue: RuntimeQueueStatus): number {
  return appendEvent(db, {
    type: "queue-status",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    queue,
  });
}

export function latestEventId(db: Database): number {
  const row = db.query(`SELECT COALESCE(MAX(id), 0) AS id FROM runtime_events`).get() as { id: number };
  return row.id;
}

export function pruneExpiredEvents(db: Database, now = new Date()): number {
  const result = db.query(`
    DELETE FROM runtime_events
    WHERE expires_at IS NOT NULL AND expires_at <= $now
  `).run({ $now: now.toISOString() });
  return result.changes;
}

export function eventsAfter(db: Database, id: number, limit = 100): RuntimeEventRow[] {
  const rows = db.query(`
    SELECT id, kind, conversation_id, stream_id, payload_json, created_at
    FROM runtime_events
    WHERE id > $id AND (expires_at IS NULL OR expires_at > $now)
    ORDER BY id ASC
    LIMIT $limit
  `).all({ $id: id, $now: new Date().toISOString(), $limit: limit }) as EventDbRow[];
  return rows.map(eventRow);
}

export function recentEvents(db: Database, input: RuntimeEventPageInput = {}): RuntimeEventRow[] {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const filters: string[] = ["(expires_at IS NULL OR expires_at > $now)", "id < $before"];
  const params: Record<string, unknown> = {
    $now: new Date().toISOString(),
    $limit: limit,
    $before: input.beforeId ?? Number.MAX_SAFE_INTEGER,
  };
  addListFilter(filters, params, "kind", input.kinds);
  if (input.role) {
    filters.push("json_extract(payload_json, '$.role') = $role");
    params.$role = input.role;
  }
  if (input.level) {
    filters.push("json_extract(payload_json, '$.level') = $level");
    params.$level = input.level;
  }
  if (input.search?.trim()) {
    filters.push("payload_json LIKE $search");
    params.$search = `%${input.search.trim()}%`;
  }
  const rows = db.query(`
    SELECT id, kind, conversation_id, stream_id, payload_json, created_at
    FROM runtime_events
    WHERE ${filters.join(" AND ")}
    ORDER BY id DESC
    LIMIT $limit
  `).all(params as never) as EventDbRow[];
  return rows.map(eventRow);
}

function addListFilter(
  filters: string[],
  params: Record<string, unknown>,
  column: string,
  values?: readonly string[],
): void {
  if (!values?.length) return;
  filters.push(`${column} IN (${values.map((_, i) => `$kind${i}`).join(", ")})`);
  values.forEach((kind, i) => {
    params[`$kind${i}`] = kind;
  });
}

interface EventDbRow {
  id: number;
  kind: string;
  conversation_id: string | null;
  stream_id: string | null;
  payload_json: string;
  created_at: string;
}
