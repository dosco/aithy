import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import { taskMigrations } from "./migrations";
import {
  ACTIVE_TASK_STATUSES,
  NOT_ACTIVE_TASK_STATUSES,
  type CreateTaskInput,
  type TaskEventRecord,
  type TaskPatch,
  type TaskQueryStatus,
  type TaskRecord,
  type TaskStatus,
  type TaskSummary,
} from "./types";
import { taskSummary } from "./summary";

interface TaskRow {
  id: string;
  kind: TaskRecord["kind"];
  status: TaskStatus;
  title: string;
  conversation_id: string | null;
  related_session_id: string | null;
  runtime_command_id: string | null;
  queue_job_id: string | null;
  memory_run_id: string | null;
  skill_candidate_id: string | null;
  permission_request_id: string | null;
  retry_of_task_id: string | null;
  attempt: number;
  reason: string | null;
  result_summary: string | null;
  error_summary: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TaskEventRow {
  id: number;
  task_id: string;
  status: TaskStatus;
  reason: string | null;
  created_at: string;
}

export class SqliteTaskStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "tasks", taskMigrations);
  }

  create(input: CreateTaskInput): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: `task_${crypto.randomUUID()}`,
      kind: input.kind,
      status: "planned",
      title: input.title,
      conversationId: input.conversationId ?? null,
      relatedSessionId: input.relatedSessionId ?? input.conversationId ?? null,
      runtimeCommandId: null,
      queueJobId: null,
      memoryRunId: null,
      skillCandidateId: null,
      permissionRequestId: null,
      retryOfTaskId: input.retryOfTaskId ?? null,
      attempt: input.attempt ?? 1,
      reason: input.reason ?? null,
      resultSummary: null,
      errorSummary: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.db.query(`
      INSERT INTO tasks (
        id, kind, status, title, conversation_id, related_session_id,
        retry_of_task_id, attempt, reason, metadata_json, created_at, updated_at
      ) VALUES (
        $id, $kind, $status, $title, $conversationId, $relatedSessionId,
        $retryOfTaskId, $attempt, $reason, $metadata, $createdAt, $updatedAt
      )
    `).run({
      $id: task.id,
      $kind: task.kind,
      $status: task.status,
      $title: task.title,
      $conversationId: task.conversationId,
      $relatedSessionId: task.relatedSessionId,
      $retryOfTaskId: task.retryOfTaskId,
      $attempt: task.attempt,
      $reason: task.reason,
      $metadata: JSON.stringify(task.metadata),
      $createdAt: task.createdAt,
      $updatedAt: task.updatedAt,
    });
    this.recordEvent(task.id, task.status, task.reason, now);
    return task;
  }

  get(id: string): TaskRecord | null {
    const row = this.db.query(`SELECT * FROM tasks WHERE id = $id`).get({ $id: id }) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  update(id: string, patch: TaskPatch): TaskRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    if (patch.status && patch.status !== existing.status && isTerminal(existing.status)) {
      return existing;
    }
    const now = new Date().toISOString();
    const nextStatus = patch.status ?? existing.status;
    const startedAt = patch.status === "running" && !existing.startedAt ? now : existing.startedAt;
    const completedAt = isTerminal(nextStatus) && !existing.completedAt ? now : existing.completedAt;
    const metadata = patch.metadata ? { ...existing.metadata, ...patch.metadata } : existing.metadata;
    this.db.query(`
      UPDATE tasks
      SET kind = $kind,
          status = $status,
          title = $title,
          conversation_id = $conversationId,
          related_session_id = $relatedSessionId,
          runtime_command_id = $runtimeCommandId,
          queue_job_id = $queueJobId,
          memory_run_id = $memoryRunId,
          skill_candidate_id = $skillCandidateId,
          permission_request_id = $permissionRequestId,
          reason = $reason,
          result_summary = $resultSummary,
          error_summary = $errorSummary,
          metadata_json = $metadata,
          updated_at = $updatedAt,
          started_at = $startedAt,
          completed_at = $completedAt
      WHERE id = $id
    `).run({
      $id: id,
      $kind: existing.kind,
      $status: nextStatus,
      $title: patch.title ?? existing.title,
      $conversationId: patch.conversationId ?? existing.conversationId,
      $relatedSessionId: patch.relatedSessionId ?? existing.relatedSessionId,
      $runtimeCommandId: patch.runtimeCommandId ?? existing.runtimeCommandId,
      $queueJobId: patch.queueJobId ?? existing.queueJobId,
      $memoryRunId: patch.memoryRunId ?? existing.memoryRunId,
      $skillCandidateId: patch.skillCandidateId ?? existing.skillCandidateId,
      $permissionRequestId: patch.permissionRequestId ?? existing.permissionRequestId,
      $reason: patch.reason === undefined ? existing.reason : patch.reason,
      $resultSummary: patch.resultSummary === undefined ? existing.resultSummary : patch.resultSummary,
      $errorSummary: patch.errorSummary === undefined ? existing.errorSummary : patch.errorSummary,
      $metadata: JSON.stringify(metadata),
      $updatedAt: now,
      $startedAt: startedAt,
      $completedAt: completedAt,
    });
    if (nextStatus !== existing.status || patch.reason !== undefined) {
      this.recordEvent(id, nextStatus, patch.reason ?? existing.reason, now);
    }
    return this.get(id);
  }

  activeForConversation(conversationId: string, limit = 10): TaskRecord[] {
    return this.listByStatuses([...ACTIVE_TASK_STATUSES], { conversationId, limit });
  }

  recent(input: { status?: TaskQueryStatus; conversationId?: string | null; limit?: number } = {}): TaskRecord[] {
    const statuses = input.status === "active"
      ? [...ACTIVE_TASK_STATUSES]
      : input.status === "not-active"
        ? [...NOT_ACTIVE_TASK_STATUSES]
        : undefined;
    return this.listByStatuses(statuses, {
      conversationId: input.conversationId,
      limit: input.limit ?? 50,
    });
  }

  summariesForAgent(input: {
    status: TaskQueryStatus;
    conversationId: string;
    limit?: number;
  }): TaskSummary[] {
    const sessionTasks = this.recent({
      status: input.status,
      conversationId: input.conversationId,
      limit: input.limit ?? 10,
    });
    const globalTasks = this.recent({
      status: input.status,
      conversationId: null,
      limit: 5,
    });
    return uniqueById([...sessionTasks, ...globalTasks])
      .slice(0, input.limit ?? 10)
      .map(taskSummary);
  }

  events(taskId: string): TaskEventRecord[] {
    const rows = this.db.query(`
      SELECT * FROM task_events WHERE task_id = $taskId ORDER BY id ASC
    `).all({ $taskId: taskId }) as TaskEventRow[];
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }

  private listByStatuses(
    statuses: TaskStatus[] | undefined,
    input: { conversationId?: string | null; limit?: number },
  ): TaskRecord[] {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const statusClause = statuses?.length
      ? `status IN (${statuses.map((_, i) => `$status${i}`).join(", ")})`
      : "1 = 1";
    const conversationClause = input.conversationId === undefined
      ? "1 = 1"
      : input.conversationId === null
        ? "conversation_id IS NULL"
        : "(conversation_id = $conversationId OR related_session_id = $conversationId)";
    const params: Record<string, unknown> = { $limit: limit };
    statuses?.forEach((status, i) => {
      params[`$status${i}`] = status;
    });
    if (input.conversationId) params.$conversationId = input.conversationId;
    const rows = this.db.query(`
      SELECT * FROM tasks
      WHERE ${statusClause} AND ${conversationClause}
      ORDER BY updated_at DESC
      LIMIT $limit
    `).all(params as never) as TaskRow[];
    return rows.map(rowToTask);
  }

  private recordEvent(taskId: string, status: TaskStatus, reason: string | null, createdAt: string): void {
    this.db.query(`
      INSERT INTO task_events (task_id, status, reason, created_at)
      VALUES ($taskId, $status, $reason, $createdAt)
    `).run({
      $taskId: taskId,
      $status: status,
      $reason: reason,
      $createdAt: createdAt,
    });
  }
}

function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    conversationId: row.conversation_id,
    relatedSessionId: row.related_session_id,
    runtimeCommandId: row.runtime_command_id,
    queueJobId: row.queue_job_id,
    memoryRunId: row.memory_run_id,
    skillCandidateId: row.skill_candidate_id,
    permissionRequestId: row.permission_request_id,
    retryOfTaskId: row.retry_of_task_id,
    attempt: row.attempt,
    reason: row.reason,
    resultSummary: row.result_summary,
    errorSummary: row.error_summary,
    metadata: parseObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function isTerminal(status: TaskStatus): boolean {
  return NOT_ACTIVE_TASK_STATUSES.includes(status);
}

function uniqueById(tasks: TaskRecord[]): TaskRecord[] {
  const seen = new Set<string>();
  const out: TaskRecord[] = [];
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    out.push(task);
  }
  return out;
}
