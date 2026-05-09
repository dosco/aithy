import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { renderResponderDescription } from "./service";
import type { SoulFields, SoulProfile, SoulStore } from "./types";

interface SoulRow {
  key: string;
  value: string;
}

const fieldKeyMap = {
  name: "bot.name",
  description: "bot.description",
  coreNature: "bot.coreNature",
  communicationStyle: "bot.communicationStyle",
  behaviour: "bot.behaviour",
  negativeBehavior: "bot.negativeBehavior",
} as const;

type FieldKey = keyof typeof fieldKeyMap;

const updatedAtKey = "bot.updatedAt";

const soulMigrations = [
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

export class SqliteSoulStore implements SoulStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    applySqliteMigrations(this.db, "soul", soulMigrations);
  }

  loadSoulProfile(): SoulProfile | undefined {
    const rows = this.db
      .query("SELECT key, value FROM metadata WHERE key LIKE 'bot.%'")
      .all() as SoulRow[];
    if (rows.length === 0) return undefined;
    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    const fields = {} as SoulFields;
    let hasField = false;
    for (const [field, key] of Object.entries(fieldKeyMap) as [FieldKey, string][]) {
      const value = byKey.get(key);
      if (value !== undefined) hasField = true;
      fields[field] = value ?? "";
    }
    if (!hasField) return undefined;

    return {
      ...fields,
      responderDescription: renderResponderDescription(fields),
      updatedAt: byKey.get(updatedAtKey) ?? new Date().toISOString(),
    };
  }

  saveSoulProfile(fields: SoulFields): SoulProfile {
    const updatedAt = new Date().toISOString();
    const upsert = this.db.query(`
      INSERT INTO metadata (key, value, hash)
      VALUES ($key, $value, NULL)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        hash = NULL
    `);
    const tx = this.db.transaction(() => {
      for (const [field, key] of Object.entries(fieldKeyMap) as [FieldKey, string][]) {
        upsert.run({ $key: key, $value: fields[field] });
      }
      upsert.run({ $key: updatedAtKey, $value: updatedAt });
    });
    tx();
    return {
      ...fields,
      responderDescription: renderResponderDescription(fields),
      updatedAt,
    };
  }

  close(): void {
    this.db.close();
  }
}
