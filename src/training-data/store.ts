import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { dpoJsonl, sftJsonl } from "./exporters";
import { trainingDataMigrations } from "./migrations";
import { normalizeChatLogEntries } from "./normalize";
import type {
  NormalizedTrainingTraceEntry,
  RecordChatLogInput,
  TrainingDataCountRow,
  TrainingDataSummary,
  TrainingPreferencePairInput,
  TrainingTraceMessage,
  TrainingTraceRecord,
  TrainingTraceStage,
} from "./types";

interface TraceRow {
  id: number;
  session_id: string;
  run_id: string | null;
  component: string;
  stage: string | null;
  name: string | null;
  model: string;
  ax_session_id: string | null;
  remote_id: string | null;
  remote_request_id: string | null;
  remote_session_id: string | null;
  provider_metadata_json: string | null;
  model_usage_json: string | null;
  messages_json: string;
  created_at: string;
}

interface CountRow {
  key: string;
  stage: string | null;
  count: number;
}

interface PreferenceRow {
  prompt_messages_json: string;
  chosen_messages_json: string;
  rejected_messages_json: string;
}

export class SqliteTrainingDataStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "training_data", trainingDataMigrations);
  }

  recordChatLog(input: RecordChatLogInput): TrainingTraceRecord[] {
    return normalizeChatLogEntries(input).map((entry) => this.insertTrace(entry));
  }

  recordPreferencePair(input: TrainingPreferencePairInput): number {
    const result = this.db.query(`
      INSERT INTO training_preference_pairs (
        session_id, chosen_trace_id, rejected_trace_id,
        prompt_messages_json, chosen_messages_json, rejected_messages_json,
        source, created_at
      ) VALUES (
        $sessionId, $chosenTraceId, $rejectedTraceId,
        $prompt, $chosen, $rejected, $source, $createdAt
      )
    `).run({
      $sessionId: input.sessionId,
      $chosenTraceId: input.chosenTraceId ?? null,
      $rejectedTraceId: input.rejectedTraceId ?? null,
      $prompt: JSON.stringify(input.promptMessages),
      $chosen: JSON.stringify(input.chosenMessages),
      $rejected: JSON.stringify(input.rejectedMessages),
      $source: input.source,
      $createdAt: input.createdAt ?? new Date().toISOString(),
    });
    return Number(result.lastInsertRowid);
  }

  summary(): TrainingDataSummary {
    const totals = this.db.query(`
      SELECT
        COUNT(*) AS traceCount,
        COUNT(DISTINCT session_id) AS sessionCount,
        MIN(created_at) AS earliestAt,
        MAX(created_at) AS latestAt
      FROM training_trace_entries
    `).get() as { traceCount: number; sessionCount: number; earliestAt: string | null; latestAt: string | null };
    const preference = this.db.query(`
      SELECT COUNT(*) AS c FROM training_preference_pairs
    `).get() as { c: number };
    return {
      traceCount: totals.traceCount,
      sftExampleCount: totals.traceCount,
      preferencePairCount: preference.c,
      sessionCount: totals.sessionCount,
      earliestAt: totals.earliestAt,
      latestAt: totals.latestAt,
      byComponent: this.counts("component", "component", 20),
      byModel: this.counts("model", "model", 20),
      bySession: this.counts("session_id", "session", 10),
    };
  }

  exportSftJsonl(): string {
    const rows = this.db.query(`
      SELECT messages_json FROM training_trace_entries ORDER BY id ASC
    `).all() as Array<{ messages_json: string }>;
    return sftJsonl(rows.map((row) => ({ messages: parseMessages(row.messages_json) })));
  }

  exportDpoJsonl(): string {
    const rows = this.db.query(`
      SELECT prompt_messages_json, chosen_messages_json, rejected_messages_json
      FROM training_preference_pairs
      ORDER BY id ASC
    `).all() as PreferenceRow[];
    return dpoJsonl(rows.map((row) => ({
      promptMessages: parseMessages(row.prompt_messages_json),
      chosenMessages: parseMessages(row.chosen_messages_json),
      rejectedMessages: parseMessages(row.rejected_messages_json),
    })));
  }

  resetAll(): number {
    const pairs = this.db.query("DELETE FROM training_preference_pairs").run().changes;
    const traces = this.db.query("DELETE FROM training_trace_entries").run().changes;
    return pairs + traces;
  }

  close(): void {
    this.db.close();
  }

  private insertTrace(entry: NormalizedTrainingTraceEntry): TrainingTraceRecord {
    const row = this.db.query(`
      INSERT INTO training_trace_entries (
        session_id, run_id, component, stage, name, model,
        ax_session_id, remote_id, remote_request_id, remote_session_id,
        provider_metadata_json, model_usage_json, messages_json, created_at
      ) VALUES (
        $sessionId, $runId, $component, $stage, $name, $model,
        $axSessionId, $remoteId, $remoteRequestId, $remoteSessionId,
        $providerMetadata, $modelUsage, $messages, $createdAt
      )
      RETURNING *
    `).get(bindTrace(entry)) as TraceRow;
    return traceFromRow(row);
  }

  private counts(column: "component" | "model" | "session_id", alias: string, limit: number): TrainingDataCountRow[] {
    const rows = this.db.query(`
      SELECT ${column} AS key, ${column === "component" ? "stage" : "NULL"} AS stage, COUNT(*) AS count
      FROM training_trace_entries
      GROUP BY ${column}${column === "component" ? ", stage" : ""}
      ORDER BY count DESC, key ASC
      LIMIT $limit
    `).all({ $limit: limit }) as CountRow[];
    return rows.map((row) => ({ key: row.key || alias, stage: stageFromRow(row.stage), count: row.count }));
  }
}

function bindTrace(entry: NormalizedTrainingTraceEntry) {
  return {
    $sessionId: entry.sessionId,
    $runId: entry.runId,
    $component: entry.component,
    $stage: entry.stage,
    $name: entry.name,
    $model: entry.model,
    $axSessionId: entry.axSessionId,
    $remoteId: entry.remoteId,
    $remoteRequestId: entry.remoteRequestId,
    $remoteSessionId: entry.remoteSessionId,
    $providerMetadata: nullableJson(entry.providerMetadata),
    $modelUsage: nullableJson(entry.modelUsage),
    $messages: JSON.stringify(entry.messages),
    $createdAt: entry.createdAt,
  };
}

function traceFromRow(row: TraceRow): TrainingTraceRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    component: row.component,
    stage: stageFromRow(row.stage),
    name: row.name,
    model: row.model,
    axSessionId: row.ax_session_id,
    remoteId: row.remote_id,
    remoteRequestId: row.remote_request_id,
    remoteSessionId: row.remote_session_id,
    providerMetadata: row.provider_metadata_json ? JSON.parse(row.provider_metadata_json) : null,
    modelUsage: row.model_usage_json ? JSON.parse(row.model_usage_json) : null,
    messages: parseMessages(row.messages_json),
    createdAt: row.created_at,
  };
}

function parseMessages(value: string): TrainingTraceMessage[] {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function stageFromRow(value: string | null): TrainingTraceStage {
  return value === "ctx" || value === "task" ? value : null;
}

function nullableJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

