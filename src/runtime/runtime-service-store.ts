import type { Database } from "bun:sqlite";
import type {
  RuntimeServiceRole,
  RuntimeServiceState,
  RuntimeServiceStatus,
} from "./protocol/types";
import { serviceRow, type ServiceDbRow } from "./runtime-store-rows";
import { appendEvent } from "./runtime-event-store";

export function heartbeat(
  db: Database,
  role: RuntimeServiceRole,
  status: RuntimeServiceState | string,
  detail?: unknown,
  options: { emitEvent?: boolean; pid?: number | null } = {},
): void {
  const previous = service(db, role);
  const detailJson = detail === undefined ? null : JSON.stringify(detail);
  const pid = options.pid ?? process.pid;
  const changed = !previous
    || previous.state !== status
    || previous.pid !== pid
    || JSON.stringify(previous.detail ?? null) !== (detailJson ?? "null");
  const lastSeenAt = new Date().toISOString();
  db.query(`
    INSERT INTO runtime_services (role, pid, status, last_seen_at, detail_json)
    VALUES ($role, $pid, $status, $lastSeenAt, $detail)
    ON CONFLICT(role) DO UPDATE SET
      pid = excluded.pid,
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      detail_json = excluded.detail_json
  `).run({
    $role: role,
    $pid: pid,
    $status: status,
    $lastSeenAt: lastSeenAt,
    $detail: detailJson,
  });
  if (options.emitEvent !== false && changed) appendServiceStatusEvent(db, role, status, detail, lastSeenAt, pid);
}

export function service(db: Database, role: RuntimeServiceRole): RuntimeServiceStatus | null {
  const row = db.query(`
    SELECT role, pid, status, last_seen_at, detail_json
    FROM runtime_services
    WHERE role = $role
  `).get({ $role: role }) as ServiceDbRow | undefined;
  return row ? serviceRow(row) : null;
}

export function services(db: Database): RuntimeServiceStatus[] {
  const rows = db.query(`
    SELECT role, pid, status, last_seen_at, detail_json
    FROM runtime_services
    ORDER BY role ASC
  `).all() as ServiceDbRow[];
  return rows.map(serviceRow);
}

function appendServiceStatusEvent(
  db: Database,
  role: RuntimeServiceRole,
  status: RuntimeServiceState | string,
  detail: unknown,
  lastSeenAt: string,
  pid: number | null,
): void {
  appendEvent(db, {
    type: "service-status",
    id: crypto.randomUUID(),
    createdAt: lastSeenAt,
    role,
    state: status as RuntimeServiceState,
    pid,
    detail: detail ?? null,
    lastSeenAt,
  });
}
