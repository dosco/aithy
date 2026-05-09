import { existsSync } from "node:fs";
import { loadConfig } from "../src/config/env";
import { renderSqliteDebug } from "../src/debug/sqlite-debug";
import { Database } from "bun:sqlite";

const config = loadConfig();
const [table, id] = parseArgs(process.argv.slice(2));

if (!existsSync(config.stateDbPath)) {
  console.error(`Database not found: ${config.stateDbPath}`);
  process.exit(1);
}

const db = new Database(config.stateDbPath, { readonly: true });
try {
  console.log(renderSqliteDebug(db, { table, id }));
} finally {
  db.close();
}

function parseArgs(args: string[]): [table?: string, id?: string] {
  const filtered = normalizeArgs(args);
  if (filtered[0] === "-h" || filtered[0] === "--help") {
    console.log("Usage: bun run debug [table] [id]");
    process.exit(0);
  }
  return [filtered[0], filtered[1]];
}

function normalizeArgs(args: string[]): string[] {
  const filtered = args.filter((arg) => arg !== "--");
  if (filtered[0] === "run" && filtered[1] === "debug") return filtered.slice(2);
  if (filtered[0] === "debug") return filtered.slice(1);
  if (filtered[0]?.endsWith("/scripts/debug.ts") || filtered[0]?.endsWith("\\scripts\\debug.ts")) {
    return filtered.slice(1);
  }
  return filtered;
}
