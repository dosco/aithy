import { existsSync, readdirSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

export interface VecExtensionState {
  customSqliteApplied: boolean;
  customSqlitePath: string | null;
  reason: string | null;
}

declare global {
  var __aithyVecExtensionState: VecExtensionState | null | undefined;
}

let state: VecExtensionState | null = globalThis.__aithyVecExtensionState ?? null;

const HOMEBREW_OPT_PATHS = [
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
];

const HOMEBREW_CELLAR_ROOTS = [
  "/opt/homebrew/Cellar/sqlite",
  "/usr/local/Cellar/sqlite",
];

probeAndConfigureSqliteImpl();

/**
 * Configure Bun's SQLite for extension loading. Process-global, idempotent.
 *
 * Linux: no-op (Bun's bundled SQLite supports extensions).
 * macOS: Bun uses Apple's system SQLite which is built with
 *   --enable-load-extension=no, so we probe for an extension-enabled build
 *   under Homebrew and swap it in via Database.setCustomSQLite.
 */
export function probeAndConfigureSqlite(): VecExtensionState {
  return probeAndConfigureSqliteImpl();
}

function probeAndConfigureSqliteImpl(): VecExtensionState {
  if (state) return state;

  if (process.platform !== "darwin") {
    return setState({ customSqliteApplied: false, customSqlitePath: null, reason: null });
  }

  for (const candidatePath of homebrewSqliteCandidates()) {
    if (!existsSync(candidatePath)) continue;
    try {
      Database.setCustomSQLite(candidatePath);
      return setState({
        customSqliteApplied: true,
        customSqlitePath: candidatePath,
        reason: null,
      });
    } catch (err) {
      if (isSqliteAlreadyLoadedError(err) && canLoadVecWithCurrentSqlite()) {
        return setState({
          customSqliteApplied: true,
          customSqlitePath: candidatePath,
          reason: null,
        });
      }
      return setState({
        customSqliteApplied: false,
        customSqlitePath: null,
        reason: `setCustomSQLite(${candidatePath}) failed: ${(err as Error).message}`,
      });
    }
  }

  return setState({
    customSqliteApplied: false,
    customSqlitePath: null,
    reason: "no extension-enabled SQLite found",
  });
}

function setState(next: VecExtensionState): VecExtensionState {
  state = next;
  globalThis.__aithyVecExtensionState = next;
  return state;
}

function homebrewSqliteCandidates(): string[] {
  const out: string[] = [...HOMEBREW_OPT_PATHS];
  // Fallback: the stable /opt/homebrew/opt/sqlite/ symlink can be missing if a
  // user ran `brew unlink sqlite`. The versioned Cellar dir still exists, so
  // pick the highest version.
  for (const root of HOMEBREW_CELLAR_ROOTS) {
    if (!existsSync(root)) continue;
    let versions: string[];
    try {
      versions = readdirSync(root);
    } catch {
      continue;
    }
    versions.sort(compareSemverDesc);
    for (const v of versions) {
      out.push(path.join(root, v, "lib", "libsqlite3.dylib"));
    }
  }
  return out;
}

function isSqliteAlreadyLoadedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("SQLite already loaded");
}

function canLoadVecWithCurrentSqlite(): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), "aithy-vec-probe-"));
  const dbPath = path.join(dir, "probe.db");
  let db: Database | null = null;
  try {
    db = new Database(dbPath);
    sqliteVec.load(db);
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function compareSemverDesc(a: string, b: string): number {
  const ap = a.split(".").map((n) => Number.parseInt(n, 10));
  const bp = b.split(".").map((n) => Number.parseInt(n, 10));
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i++) {
    const ai = Number.isFinite(ap[i]) ? ap[i] : 0;
    const bi = Number.isFinite(bp[i]) ? bp[i] : 0;
    if (ai !== bi) return bi - ai;
  }
  return 0;
}

/**
 * Boot guard: hard-fail on macOS when no extension-enabled SQLite is
 * available, with a concrete fix instruction. Linux is a no-op (Bun's
 * bundled SQLite supports extensions natively). Better to refuse to start
 * than come up half-broken with vector retrieval silently disabled.
 */
export function assertVecExtensionReady(state: VecExtensionState = probeAndConfigureSqlite()): void {
  if (process.platform !== "darwin") return;
  if (state.customSqliteApplied) return;
  throw new Error(
    [
      "Aithy can't load sqlite-vec — macOS Bun ships with Apple's system SQLite, which is built without extension support.",
      "",
      "Fix:",
      "  brew install sqlite",
      "",
      "Then restart `bun run start`. Aithy auto-detects the Homebrew sqlite path.",
      state.reason ? `(probe detail: ${state.reason})` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
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
