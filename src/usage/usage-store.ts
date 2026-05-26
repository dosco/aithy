import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { usageMigrations } from "./migrations";
import type { UsageBucket, UsageInsert, UsagePurpose, UsageRecord } from "./types";

interface Row {
  id: number;
  provider: string;
  model: string;
  purpose: UsagePurpose;
  component: string;
  stage: "ctx" | "task" | null;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  session_id: string | null;
  run_id: string | null;
  occurred_at: string;
}

interface BucketRow {
  bucket: string;
  provider: string;
  model: string;
  purpose: UsagePurpose;
  component: string;
  stage: "ctx" | "task" | null;
  input_tokens: number;
  output_tokens: number;
  thought_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  calls: number;
}

export class SqliteUsageStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "usage", usageMigrations);
  }

  record(input: UsageInsert): UsageRecord {
    const total =
      input.totalTokens ??
      input.inputTokens + input.outputTokens + (input.thoughtTokens ?? 0);
    const result = this.db
      .query(
        `INSERT INTO llm_usage (
           provider, model, purpose, component, stage,
           input_tokens, output_tokens, thought_tokens,
           cache_creation_tokens, cache_read_tokens, total_tokens,
           session_id, run_id, occurred_at
         ) VALUES (
           $provider, $model, $purpose, $component, $stage,
           $in, $out, $thought, $cacheCreation, $cacheRead, $total,
           $sessionId, $runId, $now
         )
         RETURNING *`,
      )
      .get({
        $provider: input.provider,
        $model: input.model,
        $purpose: input.purpose,
        $component: input.component?.trim() || input.purpose,
        $stage: input.stage ?? null,
        $in: input.inputTokens,
        $out: input.outputTokens,
        $thought: input.thoughtTokens ?? 0,
        $cacheCreation: input.cacheCreationTokens ?? 0,
        $cacheRead: input.cacheReadTokens ?? 0,
        $total: total,
        $sessionId: input.sessionId ?? null,
        $runId: input.runId ?? null,
        $now: new Date().toISOString(),
      }) as Row;
    return rowToRecord(result);
  }

  recent(limit = 200): UsageRecord[] {
    const rows = this.db
      .query(`SELECT * FROM llm_usage ORDER BY id DESC LIMIT $limit`)
      .all({ $limit: limit }) as Row[];
    return rows.map(rowToRecord);
  }

  recordsSince(days = 30): UsageRecord[] {
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.db
      .query(`SELECT * FROM llm_usage WHERE occurred_at >= $since ORDER BY occurred_at ASC, id ASC`)
      .all({ $since: sinceIso }) as Row[];
    return rows.map(rowToRecord);
  }

  /**
   * Aggregate usage by day, grouped by model + purpose. Date math uses
   * SQLite's date() which expects ISO timestamps — what we already store.
   */
  byDay(days = 30): UsageBucket[] {
    const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.db
      .query(
        `SELECT date(occurred_at) AS bucket,
                provider, model, purpose, component, stage,
                SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens,
                SUM(thought_tokens) AS thought_tokens,
                SUM(cache_creation_tokens) AS cache_creation_tokens,
                SUM(cache_read_tokens) AS cache_read_tokens,
                SUM(total_tokens) AS total_tokens,
                COUNT(*) AS calls
         FROM llm_usage
         WHERE date(occurred_at) >= date($since)
         GROUP BY bucket, provider, model, purpose, component, stage
         ORDER BY bucket ASC, provider ASC, model ASC, purpose ASC, component ASC, stage ASC`,
      )
      .all({ $since: sinceIso }) as BucketRow[];
    return rows.map(bucketRow);
  }

  totals(): {
    callsAllTime: number;
    tokensAllTime: number;
    tokensLast24h: number;
    tokensLast7d: number;
  } {
    const all = this.db
      .query(`SELECT COUNT(*) AS c, COALESCE(SUM(total_tokens),0) AS t FROM llm_usage`)
      .get() as { c: number; t: number };
    const day = this.db
      .query(
        `SELECT COALESCE(SUM(total_tokens),0) AS t FROM llm_usage WHERE occurred_at >= $since`,
      )
      .get({ $since: new Date(Date.now() - 86_400_000).toISOString() }) as { t: number };
    const week = this.db
      .query(
        `SELECT COALESCE(SUM(total_tokens),0) AS t FROM llm_usage WHERE occurred_at >= $since`,
      )
      .get({ $since: new Date(Date.now() - 7 * 86_400_000).toISOString() }) as { t: number };
    return {
      callsAllTime: all.c,
      tokensAllTime: all.t,
      tokensLast24h: day.t,
      tokensLast7d: week.t,
    };
  }

  close(): void {
    this.db.close();
  }
}

function rowToRecord(row: Row): UsageRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    purpose: row.purpose,
    component: row.component ?? row.purpose,
    stage: row.stage ?? null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    thoughtTokens: row.thought_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    totalTokens: row.total_tokens,
    sessionId: row.session_id,
    runId: row.run_id,
    occurredAt: row.occurred_at,
  };
}

function bucketRow(row: BucketRow): UsageBucket {
  return {
    bucket: row.bucket,
    provider: row.provider,
    model: row.model,
    purpose: row.purpose,
    component: row.component ?? row.purpose,
    stage: row.stage ?? null,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    thoughtTokens: row.thought_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    totalTokens: row.total_tokens,
    calls: row.calls,
  };
}
