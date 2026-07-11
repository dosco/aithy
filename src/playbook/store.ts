import { Database } from "bun:sqlite";
import type { AxPlaybookSnapshot } from "../agent/ax-boundary";

export const RESPONDER_PLAYBOOK_KEY = "playbook.responder";
export const MAX_PLAYBOOK_BYTES = 64 * 1024;

export class ResponderPlaybookStore {
  private readonly db: Database;
  constructor(dbPath: string) { this.db = new Database(dbPath, { create: true }); this.db.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, hash TEXT);"); }
  load(): AxPlaybookSnapshot | null {
    const row = this.db.query("SELECT value FROM metadata WHERE key = $key").get({ $key: RESPONDER_PLAYBOOK_KEY }) as { value: string } | undefined;
    if (!row || new TextEncoder().encode(row.value).length > MAX_PLAYBOOK_BYTES) return null;
    try { return JSON.parse(row.value) as AxPlaybookSnapshot; } catch { return null; }
  }
  save(snapshot: AxPlaybookSnapshot): void {
    const value = JSON.stringify(snapshot);
    if (new TextEncoder().encode(value).length > MAX_PLAYBOOK_BYTES) throw new PlaybookTooLargeError();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db.query(`INSERT INTO metadata (key, value, hash) VALUES ($key, $value, NULL)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, hash = NULL`).run({ $key: RESPONDER_PLAYBOOK_KEY, $value: value });
      this.db.exec("COMMIT;");
    } catch (error) { this.db.exec("ROLLBACK;"); throw error; }
  }
  reset(): void { this.db.query("DELETE FROM metadata WHERE key = $key").run({ $key: RESPONDER_PLAYBOOK_KEY }); }
  close(): void { this.db.close(); }
}

export class PlaybookTooLargeError extends Error { constructor() { super("Responder playbook exceeded the 64 KiB cap"); } }

export class ResponderPlaybookCache {
  private current: AxPlaybookSnapshot | null;
  constructor(private readonly store: ResponderPlaybookStore) { this.current = store.load(); }
  snapshot(): AxPlaybookSnapshot | null { return this.current; }
  refresh(): void { this.current = this.store.load(); }
  reset(): void { this.store.reset(); this.current = null; }
}
