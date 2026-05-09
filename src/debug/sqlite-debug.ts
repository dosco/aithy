import type { Database } from "bun:sqlite";

const lookupColumns = ["id", "key", "version", "conversation_id", "session_id"] as const;
const rowLimit = 100;

export interface DebugSelection {
  table?: string;
  id?: string;
}

export function renderSqliteDebug(db: Database, selection: DebugSelection = {}): string {
  if (!selection.table) return renderTableList(db);
  return renderTableDetail(db, selection.table, selection.id);
}

export function renderTableList(db: Database): string {
  const tables = tableNames(db);
  if (tables.length === 0) {
    return "No tables found.\nUse: bun run debug <table> [id]";
  }

  const lines = ["Tables:"];
  for (const table of tables) {
    const count = tableRowCount(db, table);
    lines.push(`- ${table} (${count} row${count === 1 ? "" : "s"})`);
  }
  lines.push("", "Use: bun run debug <table> [id]");
  return lines.join("\n");
}

export function renderTableDetail(db: Database, table: string, id?: string): string {
  const tables = tableNames(db);
  if (!tables.includes(table)) {
    return [`Unknown table: ${table}`, `Available tables: ${tables.join(", ") || "(none)"}`].join("\n");
  }

  const columns = tableColumns(db, table);
  const lookupColumn = pickLookupColumn(columns);
  const schema = tableSchema(db, table);
  const rowCount = tableRowCount(db, table);
  const rows = id === undefined
    ? tableRows(db, table, lookupColumn, undefined)
    : tableRows(db, table, lookupColumn, id);

  const lines = [
    `Table: ${table}`,
    `Lookup column: ${lookupColumn}`,
    `Rows: ${rows.length}${id === undefined ? ` of ${rowCount}` : ""}`,
  ];

  if (schema) {
    lines.push("", "Schema:", schema.trim());
  }

  lines.push("", id === undefined ? "Rows:" : `Lookup value: ${id}`, formatJson(rows));

  if (id === undefined && rowCount > rowLimit) {
    lines.push("", `Showing first ${rowLimit} of ${rowCount} rows.`);
  }

  return lines.join("\n");
}

function tableNames(db: Database): string[] {
  const rows = db.query(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function tableColumns(db: Database, table: string): string[] {
  const rows = db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function tableSchema(db: Database, table: string): string | undefined {
  const row = db.query(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = $name
  `).get({ $name: table }) as { sql: string } | undefined;
  return row?.sql;
}

function tableRowCount(db: Database, table: string): number {
  const row = db.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count: number };
  return row.count;
}

function tableRows(
  db: Database,
  table: string,
  lookupColumn: string,
  id: string | undefined,
): Record<string, unknown>[] {
  const base = `SELECT * FROM ${quoteIdentifier(table)}`;
  const orderBy = ` ORDER BY ${quoteIdentifier(lookupColumn)} ASC`;
  if (id === undefined) {
    return db.query(`${base}${orderBy} LIMIT ${rowLimit}`).all() as Record<string, unknown>[];
  }
  return db.query(`${base} WHERE ${quoteIdentifier(lookupColumn)} = $id${orderBy} LIMIT ${rowLimit}`)
    .all({ $id: id }) as Record<string, unknown>[];
}

function pickLookupColumn(columns: string[]): string {
  for (const candidate of lookupColumns) {
    if (columns.includes(candidate)) return candidate;
  }
  return columns[0] ?? "rowid";
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
