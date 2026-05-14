import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import {
  defaultUiPreferences,
  metadataSettingsKey,
  type SettingsPatch,
  type StoredSettings,
} from "./types";

interface MetadataRow {
  value: string;
}

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        hash TEXT
      );
    `,
  },
];

export class SqliteSettingsStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "settings", migrations);
  }

  load(): StoredSettings {
    const row = this.db.query(`
      SELECT value FROM metadata WHERE key = $key
    `).get({ $key: metadataSettingsKey }) as MetadataRow | undefined;
    if (!row) return emptySettings();
    return normalizeSettings(JSON.parse(row.value));
  }

  save(patch: SettingsPatch): StoredSettings {
    const current = this.load();
    const next: StoredSettings = {
      runtime: normalizeRuntimeSettings({ ...current.runtime, ...patch.runtime }),
      ui: { ...current.ui, ...patch.ui },
      updatedAt: new Date().toISOString(),
    };
    this.db.query(`
      INSERT INTO metadata (key, value, hash)
      VALUES ($key, $value, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run({
      $key: metadataSettingsKey,
      $value: JSON.stringify(next),
    });
    return next;
  }

  reset(): StoredSettings {
    const next = emptySettings();
    this.db.query(`
      DELETE FROM metadata WHERE key = $key
    `).run({ $key: metadataSettingsKey });
    return next;
  }

  close(): void {
    this.db.close();
  }
}

function emptySettings(): StoredSettings {
  return {
    runtime: {},
    ui: { ...defaultUiPreferences },
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeSettings(value: Partial<StoredSettings>): StoredSettings {
  return {
    runtime: normalizeRuntimeSettings(value.runtime ?? {}),
    ui: { ...defaultUiPreferences, ...value.ui },
    updatedAt: value.updatedAt ?? new Date(0).toISOString(),
  };
}

function normalizeRuntimeSettings(runtime: StoredSettings["runtime"]): StoredSettings["runtime"] {
  const next = { ...runtime };
  const sandboxProvider = normalizeSandboxProvider(next.sandboxProvider);
  if (sandboxProvider) next.sandboxProvider = sandboxProvider;
  else delete next.sandboxProvider;
  if (typeof next.systemBashEnabled !== "boolean") {
    delete next.systemBashEnabled;
  }
  return next;
}

function normalizeSandboxProvider(value: unknown): StoredSettings["runtime"]["sandboxProvider"] {
  if (value === "microsandbox") return "microsandbox";
  if (value === "disabled" || value === "mock") return "disabled";
  return undefined;
}
