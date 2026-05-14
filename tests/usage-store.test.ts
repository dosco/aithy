import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteUsageStore } from "../src/usage/usage-store";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-usage-"));
  return path.join(dir, "state.db");
}

function explainQueryPlan(db: Database, sql: string): string {
  const rows = db.query(sql).all() as Array<Record<string, unknown>>;
  return rows.map((row) => Object.values(row).join(" | ")).join("\n");
}

describe("SqliteUsageStore", () => {
  test("records and returns thought tokens", async () => {
    const store = new SqliteUsageStore(await tempDbPath());

    const record = store.record({
      provider: "openai",
      model: "gpt-5.4-mini",
      purpose: "chat",
      inputTokens: 12,
      outputTokens: 8,
      thoughtTokens: 4,
      cacheCreationTokens: 3,
      cacheReadTokens: 5,
      sessionId: "session-1",
      runId: "run-1",
    });

    expect(record).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini",
      purpose: "chat",
      inputTokens: 12,
      outputTokens: 8,
      thoughtTokens: 4,
      cacheCreationTokens: 3,
      cacheReadTokens: 5,
      totalTokens: 24,
      sessionId: "session-1",
      runId: "run-1",
    });
    expect(store.recent(1)[0]).toMatchObject({
      thoughtTokens: 4,
      cacheCreationTokens: 3,
      cacheReadTokens: 5,
      totalTokens: 24,
    });
  });

  test("aggregates daily input, output, and thinking tokens", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteUsageStore(dbPath);
    const db = new Database(dbPath);
    db.exec(`
      INSERT INTO llm_usage (
        provider, model, purpose,
        input_tokens, output_tokens, thought_tokens,
        cache_creation_tokens, cache_read_tokens, total_tokens,
        session_id, run_id, occurred_at
      ) VALUES
        ('openai', 'gpt-5.4-mini', 'chat', 10, 20, 5, 4, 7, 35, 's1', 'r1', '2026-05-08T08:00:00.000Z'),
        ('openai', 'gpt-5.4-mini', 'chat', 2, 3, 1, 2, 5, 6, 's1', 'r2', '2026-05-08T09:00:00.000Z'),
        ('openai', 'gpt-5.4-mini', 'chat', 1, 1, 4, 1, 1, 6, 's1', 'r3', '2026-05-09T10:00:00.000Z');
    `);
    db.close();

    expect(store.byDay(400)).toMatchObject([
      {
        bucket: "2026-05-08",
        provider: "openai",
        model: "gpt-5.4-mini",
        purpose: "chat",
        inputTokens: 12,
        outputTokens: 23,
        thoughtTokens: 6,
        cacheCreationTokens: 6,
        cacheReadTokens: 12,
        totalTokens: 41,
        calls: 2,
      },
      {
        bucket: "2026-05-09",
        provider: "openai",
        model: "gpt-5.4-mini",
        purpose: "chat",
        inputTokens: 1,
        outputTokens: 1,
        thoughtTokens: 4,
        cacheCreationTokens: 1,
        cacheReadTokens: 1,
        totalTokens: 6,
        calls: 1,
      },
    ]);
  });

  test("migrates to the day bucket index and keeps occurred_at for time windows", async () => {
    const dbPath = await tempDbPath();
    const seed = new Database(dbPath, { create: true });
    seed.exec(`
      CREATE TABLE schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (scope, version)
      );

      INSERT INTO schema_migrations(scope, version, applied_at)
      VALUES ('usage', 1, '2026-05-08T00:00:00.000Z');

      CREATE TABLE llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        purpose TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thought_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        run_id TEXT,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX llm_usage_occurred_idx ON llm_usage(occurred_at DESC);
      CREATE INDEX llm_usage_purpose_idx ON llm_usage(purpose, occurred_at DESC);
      CREATE INDEX llm_usage_model_idx ON llm_usage(provider, model, occurred_at DESC);
    `);
    seed.close();

    new SqliteUsageStore(dbPath);
    const db = new Database(dbPath, { readonly: true });

    const indexRows = db.query(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'llm_usage'
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(indexRows.map((row) => row.name)).toContain("llm_usage_occurred_idx");
    expect(indexRows.map((row) => row.name)).toContain("llm_usage_day_idx");
    expect(indexRows.map((row) => row.name)).not.toContain("llm_usage_purpose_idx");
    expect(indexRows.map((row) => row.name)).not.toContain("llm_usage_model_idx");

    const columns = db.query(`PRAGMA table_info(llm_usage)`).all() as Array<{ name: string }>;
    expect(columns.map((row) => row.name)).toContain("cache_creation_tokens");
    expect(columns.map((row) => row.name)).toContain("cache_read_tokens");

    const groupedPlan = explainQueryPlan(
      db,
      `
        EXPLAIN QUERY PLAN
        SELECT date(occurred_at) AS bucket,
               provider, model, purpose,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(thought_tokens) AS thought_tokens,
               SUM(cache_creation_tokens) AS cache_creation_tokens,
               SUM(cache_read_tokens) AS cache_read_tokens,
               SUM(total_tokens) AS total_tokens,
               COUNT(*) AS calls
        FROM llm_usage
        WHERE date(occurred_at) >= date('2026-05-01T00:00:00.000Z')
        GROUP BY bucket, provider, model, purpose
        ORDER BY bucket ASC, provider ASC, model ASC, purpose ASC
      `,
    );
    expect(groupedPlan).toContain("llm_usage_day_idx");

    const windowPlan = explainQueryPlan(
      db,
      `
        EXPLAIN QUERY PLAN
        SELECT COALESCE(SUM(total_tokens), 0) AS t
        FROM llm_usage
        WHERE occurred_at >= '2026-05-07T00:00:00.000Z'
      `,
    );
    expect(windowPlan).toContain("llm_usage_occurred_idx");

    db.close();
  });

  test("adds cache columns when migrating from the day-index schema", async () => {
    const dbPath = await tempDbPath();
    const seed = new Database(dbPath, { create: true });
    seed.exec(`
      CREATE TABLE schema_migrations (
        scope TEXT NOT NULL,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (scope, version)
      );

      INSERT INTO schema_migrations(scope, version, applied_at)
      VALUES
        ('usage', 1, '2026-05-08T00:00:00.000Z'),
        ('usage', 2, '2026-05-08T00:00:01.000Z');

      CREATE TABLE llm_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        purpose TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        thought_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        run_id TEXT,
        occurred_at TEXT NOT NULL
      );

      CREATE INDEX llm_usage_occurred_idx ON llm_usage(occurred_at DESC);
      CREATE INDEX llm_usage_day_idx
        ON llm_usage(date(occurred_at), provider, model, purpose);
    `);
    seed.close();

    const store = new SqliteUsageStore(dbPath);
    const record = store.record({
      provider: "openai",
      model: "gpt-5.4-mini",
      purpose: "chat",
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 1,
    });

    expect(record).toMatchObject({
      cacheCreationTokens: 0,
      cacheReadTokens: 1,
      totalTokens: 3,
    });
  });
});
