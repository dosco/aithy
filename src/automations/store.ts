import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { automationMigrations } from "./migrations";
import { parseSchedule } from "./schedule";
import type {
  AutomationAttentionType,
  AutomationPatch,
  AutomationRecord,
  AutomationRunPatch,
  AutomationRunRecord,
  AutomationRunStatus,
  AutomationStatus,
  CreateAutomationInput,
  CreateAutomationRunInput,
} from "./types";

interface AutomationRow {
  id: string;
  status: AutomationStatus;
  attention_type: AutomationAttentionType;
  title: string;
  prompt: string;
  schedule_json: string;
  timezone: string;
  notification_policy: AutomationRecord["notificationPolicy"];
  origin_session_id: string;
  created_source: AutomationRecord["createdSource"];
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AutomationRunRow {
  id: string;
  automation_id: string;
  run_session_id: string | null;
  task_id: string | null;
  status: AutomationRunStatus;
  triggered_at: string;
  scheduled_for: string;
  result_summary: string | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class SqliteAutomationStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "automations", automationMigrations);
  }

  create(input: CreateAutomationInput): AutomationRecord {
    const now = new Date().toISOString();
    const record: AutomationRecord = {
      id: `automation_${crypto.randomUUID()}`,
      status: "active",
      attentionType: input.attentionType,
      title: input.title,
      prompt: input.prompt,
      schedule: input.schedule,
      timezone: input.timezone,
      notificationPolicy: input.notificationPolicy,
      originSessionId: input.originSessionId,
      createdSource: input.createdSource,
      nextRunAt: null,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.query(`
      INSERT INTO automations (
        id, status, attention_type, title, prompt, schedule_json, timezone, notification_policy,
        origin_session_id, created_source, created_at, updated_at
      ) VALUES (
        $id, $status, $attentionType, $title, $prompt, $schedule, $timezone, $policy,
        $originSessionId, $createdSource, $createdAt, $updatedAt
      )
    `).run(paramsForAutomation(record));
    return record;
  }

  get(id: string): AutomationRecord | null {
    const row = this.db.query(`SELECT * FROM automations WHERE id = $id`).get({ $id: id }) as AutomationRow | undefined;
    return row ? rowToAutomation(row) : null;
  }

  list(input: { includeArchived?: boolean; originSessionId?: string } = {}): AutomationRecord[] {
    const archived = input.includeArchived ? "1 = 1" : "status != 'archived'";
    const origin = input.originSessionId ? "origin_session_id = $originSessionId" : "1 = 1";
    const rows = this.db.query(`
      SELECT * FROM automations
      WHERE ${archived} AND ${origin}
      ORDER BY status = 'active' DESC, COALESCE(next_run_at, updated_at) ASC
    `).all({ $originSessionId: input.originSessionId ?? "" }) as AutomationRow[];
    return rows.map(rowToAutomation);
  }

  active(): AutomationRecord[] {
    const rows = this.db.query(`
      SELECT * FROM automations WHERE status = 'active' ORDER BY updated_at DESC
    `).all() as AutomationRow[];
    return rows.map(rowToAutomation);
  }

  update(id: string, patch: AutomationPatch): AutomationRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next: AutomationRecord = {
      ...existing,
      status: patch.status ?? existing.status,
      attentionType: patch.attentionType ?? existing.attentionType,
      title: patch.title ?? existing.title,
      prompt: patch.prompt ?? existing.prompt,
      schedule: patch.schedule ?? existing.schedule,
      timezone: patch.timezone ?? existing.timezone,
      notificationPolicy: patch.notificationPolicy ?? existing.notificationPolicy,
      originSessionId: patch.originSessionId ?? existing.originSessionId,
      nextRunAt: patch.nextRunAt === undefined ? existing.nextRunAt : patch.nextRunAt,
      lastRunAt: patch.lastRunAt === undefined ? existing.lastRunAt : patch.lastRunAt,
      updatedAt: new Date().toISOString(),
    };
    this.db.query(`
      UPDATE automations
      SET status = $status,
          attention_type = $attentionType,
          title = $title,
          prompt = $prompt,
          schedule_json = $schedule,
          timezone = $timezone,
          notification_policy = $policy,
          origin_session_id = $originSessionId,
          next_run_at = $nextRunAt,
          last_run_at = $lastRunAt,
          updated_at = $updatedAt
      WHERE id = $id
    `).run(paramsForAutomation(next));
    return this.get(id);
  }

  createRun(input: CreateAutomationRunInput): AutomationRunRecord {
    const now = new Date().toISOString();
    const run: AutomationRunRecord = {
      id: `automation_run_${crypto.randomUUID()}`,
      automationId: input.automationId,
      runSessionId: null,
      taskId: null,
      status: "queued",
      triggeredAt: input.triggeredAt,
      scheduledFor: input.scheduledFor,
      resultSummary: null,
      errorSummary: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.db.query(`
      INSERT INTO automation_runs (
        id, automation_id, status, triggered_at, scheduled_for, created_at, updated_at
      ) VALUES (
        $id, $automationId, $status, $triggeredAt, $scheduledFor, $createdAt, $updatedAt
      )
    `).run(paramsForRun(run));
    return run;
  }

  getRun(id: string): AutomationRunRecord | null {
    const row = this.db.query(`SELECT * FROM automation_runs WHERE id = $id`).get({ $id: id }) as AutomationRunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  updateRun(id: string, patch: AutomationRunPatch): AutomationRunRecord | null {
    const existing = this.getRun(id);
    if (!existing) return null;
    const status = patch.status ?? existing.status;
    const now = new Date().toISOString();
    const next: AutomationRunRecord = {
      ...existing,
      runSessionId: patch.runSessionId === undefined ? existing.runSessionId : patch.runSessionId,
      taskId: patch.taskId === undefined ? existing.taskId : patch.taskId,
      status,
      resultSummary: patch.resultSummary === undefined ? existing.resultSummary : patch.resultSummary,
      errorSummary: patch.errorSummary === undefined ? existing.errorSummary : patch.errorSummary,
      updatedAt: now,
      completedAt: isTerminal(status) && !existing.completedAt ? now : existing.completedAt,
    };
    this.db.query(`
      UPDATE automation_runs
      SET run_session_id = $runSessionId,
          task_id = $taskId,
          status = $status,
          result_summary = $resultSummary,
          error_summary = $errorSummary,
          updated_at = $updatedAt,
          completed_at = $completedAt
      WHERE id = $id
    `).run(paramsForRun(next));
    return this.getRun(id);
  }

  recentRuns(automationId: string, limit = 8): AutomationRunRecord[] {
    const rows = this.db.query(`
      SELECT * FROM automation_runs
      WHERE automation_id = $automationId
      ORDER BY created_at DESC
      LIMIT $limit
    `).all({ $automationId: automationId, $limit: Math.max(1, Math.min(limit, 50)) }) as AutomationRunRow[];
    return rows.map(rowToRun);
  }

  hasActiveRun(automationId: string): boolean {
    const row = this.db.query(`
      SELECT id FROM automation_runs
      WHERE automation_id = $automationId AND status IN ('queued', 'running')
      LIMIT 1
    `).get({ $automationId: automationId }) as { id: string } | undefined;
    return Boolean(row);
  }

  close(): void {
    this.db.close();
  }
}

function paramsForAutomation(record: AutomationRecord) {
  return {
    $id: record.id,
    $status: record.status,
    $attentionType: record.attentionType,
    $title: record.title,
    $prompt: record.prompt,
    $schedule: JSON.stringify(record.schedule),
    $timezone: record.timezone,
    $policy: record.notificationPolicy,
    $originSessionId: record.originSessionId,
    $createdSource: record.createdSource,
    $nextRunAt: record.nextRunAt,
    $lastRunAt: record.lastRunAt,
    $createdAt: record.createdAt,
    $updatedAt: record.updatedAt,
  };
}

function paramsForRun(run: AutomationRunRecord) {
  return {
    $id: run.id,
    $automationId: run.automationId,
    $runSessionId: run.runSessionId,
    $taskId: run.taskId,
    $status: run.status,
    $triggeredAt: run.triggeredAt,
    $scheduledFor: run.scheduledFor,
    $resultSummary: run.resultSummary,
    $errorSummary: run.errorSummary,
    $createdAt: run.createdAt,
    $updatedAt: run.updatedAt,
    $completedAt: run.completedAt,
  };
}

function rowToAutomation(row: AutomationRow): AutomationRecord {
  return {
    id: row.id,
    status: row.status,
    attentionType: row.attention_type ?? "ritual",
    title: row.title,
    prompt: row.prompt,
    schedule: parseSchedule(row.schedule_json),
    timezone: row.timezone,
    notificationPolicy: row.notification_policy,
    originSessionId: row.origin_session_id,
    createdSource: row.created_source,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: AutomationRunRow): AutomationRunRecord {
  return {
    id: row.id,
    automationId: row.automation_id,
    runSessionId: row.run_session_id,
    taskId: row.task_id,
    status: row.status,
    triggeredAt: row.triggered_at,
    scheduledFor: row.scheduled_for,
    resultSummary: row.result_summary,
    errorSummary: row.error_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function isTerminal(status: AutomationRunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
