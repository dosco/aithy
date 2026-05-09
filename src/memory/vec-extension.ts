import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

export interface VecExtensionState {
  customSqliteApplied: boolean;
  customSqlitePath: string | null;
  reason: string | null;
}

let state: VecExtensionState | null = null;

const HOMEBREW_PATHS = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
];

// Eager side effect: probe and call setCustomSQLite at module load so any
// `new Database()` in this process — runtime, scripts, or tests — sees the
// extension-enabled SQLite. Idempotent; no-op on Linux. Without this,
// import-order timing in test runners can lock in Apple's stripped SQLite
// before the runtime gets a chance to swap.
probeAndConfigureSqliteImpl();

/**
 * Configure Bun's SQLite for extension loading. Process-global, idempotent.
 * Already invoked once at module load — public API kept for explicit calls
 * from script entry points.
 *
 * Linux: no-op (Bun's bundled SQLite supports extensions).
 * macOS: Bun uses Apple's system SQLite which has --enable-load-extension=no,
 *   so we probe for an extension-enabled build (Homebrew sqlite) and swap it
 *   in via Database.setCustomSQLite. AITHY_SQLITE_DYLIB env var overrides.
 */
export function probeAndConfigureSqlite(): VecExtensionState {
  return probeAndConfigureSqliteImpl();
}

function probeAndConfigureSqliteImpl(): VecExtensionState {
  if (state) return state;

  if (process.platform !== "darwin") {
    state = { customSqliteApplied: false, customSqlitePath: null, reason: null };
    return state;
  }

  const override = process.env.AITHY_SQLITE_DYLIB?.trim();
  const candidates = override ? [override, ...HOMEBREW_PATHS] : HOMEBREW_PATHS;

  for (const candidatePath of candidates) {
    if (!existsSync(candidatePath)) continue;
    try {
      Database.setCustomSQLite(candidatePath);
      state = {
        customSqliteApplied: true,
        customSqlitePath: candidatePath,
        reason: null,
      };
      return state;
    } catch (err) {
      state = {
        customSqliteApplied: false,
        customSqlitePath: null,
        reason: `setCustomSQLite(${candidatePath}) failed: ${(err as Error).message}`,
      };
      return state;
    }
  }

  state = {
    customSqliteApplied: false,
    customSqlitePath: null,
    reason: "no extension-enabled SQLite found (try `brew install sqlite`)",
  };
  return state;
}

/**
 * Load sqlite-vec into a database connection. Caller must have invoked
 * probeAndConfigureSqlite() once before opening the database.
 */
export function tryLoadVecExtension(
  db: Database,
  log?: (msg: string) => void,
): { ok: true } | { ok: false; reason: string } {
  try {
    sqliteVec.load(db);
    return { ok: true };
  } catch (err) {
    const reason = (err as Error).message;
    log?.(`memory: vec extension failed to load — ${reason}`);
    return { ok: false, reason };
  }
}
