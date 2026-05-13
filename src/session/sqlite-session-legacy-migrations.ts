import type { Database } from "bun:sqlite";

export function migrateSessionMountsToGlobal(db: Database): void {
  const tableRow = db.query(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'session_mounts'
  `).get() as { name: string } | undefined;
  if (!tableRow) return;

  const rows = db.query(`
    SELECT DISTINCT host_path FROM session_mounts ORDER BY host_path
  `).all() as Array<{ host_path: string }>;

  if (rows.length > 0) migrateMountRows(db, rows);

  db.exec("DROP INDEX IF EXISTS session_mounts_session_idx;");
  db.exec("DROP TABLE IF EXISTS session_mounts;");
}

function migrateMountRows(db: Database, rows: Array<{ host_path: string }>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      hash TEXT
    );
  `);
  const settingsRow = db.query(`
    SELECT value FROM metadata WHERE key = 'web.settings'
  `).get() as { value: string } | undefined;
  const parsed = settingsRow ? tryParseJson(settingsRow.value) : { ok: true, value: {} as Record<string, unknown> };
  if (!parsed.ok) {
    console.warn("[session-state-store] web.settings JSON unparseable; dropping session_mounts without migrating data");
    return;
  }

  const settings = parsed.value;
  const runtime = (settings.runtime ??= {}) as Record<string, unknown>;
  const existing = Array.isArray(runtime.globalMounts)
    ? (runtime.globalMounts as Array<{ hostPath: string }>)
    : [];
  const seen = new Set(existing.map((m) => m.hostPath));
  for (const row of rows) {
    if (seen.has(row.host_path)) continue;
    existing.push({ hostPath: row.host_path });
    seen.add(row.host_path);
  }
  runtime.globalMounts = existing;
  settings.updatedAt = new Date().toISOString();
  db.query(`
    INSERT INTO metadata (key, value, hash)
    VALUES ('web.settings', $value, NULL)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run({ $value: JSON.stringify(settings) });
}

function tryParseJson(
  value: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ok: true, value: parsed as Record<string, unknown> }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}
