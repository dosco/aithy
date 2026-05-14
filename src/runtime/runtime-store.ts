import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type {
  CommandCompletion,
  RuntimeLogEventPayload,
  RuntimeQueueStatus,
  RuntimeServiceRole,
  RuntimeServiceState,
  RuntimeServiceStatus,
} from "./protocol/types";
import type { WebLiveEvent } from "../web/live-events";
import {
  claimCommand as claimRuntimeCommand,
  claimPendingCommands as claimPendingRuntimeCommands,
  commandById as runtimeCommandById,
  completeCommand as completeRuntimeCommand,
  completionFromRow,
  enqueueCommand as enqueueRuntimeCommand,
  recentCommands as recentRuntimeCommands,
  unfinishedCommands as unfinishedRuntimeCommands,
} from "./runtime-command-store";
import {
  appendEvent as appendRuntimeEvent,
  appendLog as appendRuntimeLog,
  appendQueueStatus as appendRuntimeQueueStatus,
  eventsAfter as runtimeEventsAfter,
  latestEventId as latestRuntimeEventId,
  pruneExpiredEvents as pruneRuntimeExpiredEvents,
  recentEvents as recentRuntimeEvents,
} from "./runtime-event-store";
import {
  auditTool as auditRuntimeTool,
  ensureGrant as ensureRuntimeGrant,
  grantDecision as runtimeGrantDecision,
} from "./runtime-grants-store";
import {
  createPermissionRequest as createRuntimePermissionRequest,
  decidePermissionRequest as decideRuntimePermissionRequest,
  pendingPermissionRequests as pendingRuntimePermissionRequests,
  permissionRequest as runtimePermissionRequest,
  type CreateSystemPermissionRequestInput,
  type SystemPermissionRequest,
  type SystemPermissionStatus,
} from "./permission-requests";
import { applyRuntimeStoreMigrations } from "./runtime-store-migrations";
import { heartbeat as runtimeHeartbeat, service as runtimeService, services as runtimeServices } from "./runtime-service-store";
import type {
  RuntimeCommandRow,
  RuntimeCommandStatus,
  RuntimeEventPageInput,
  RuntimeEventRow,
  ToolAuditInput,
} from "./runtime-store-types";

export type {
  RuntimeCommandRow,
  RuntimeCommandStatus,
  RuntimeEventPageInput,
  RuntimeEventRow,
  ToolAuditInput,
} from "./runtime-store-types";
export type {
  CreateSystemPermissionRequestInput,
  SystemPermissionRequest,
  SystemPermissionStatus,
} from "./permission-requests";

const EXPIRED_EVENT_PRUNE_INTERVAL_MS = 60_000;

export class RuntimeStore {
  private readonly db: Database;
  private lastExpiredEventPruneAt = 0;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applyRuntimeStoreMigrations(this.db);
  }

  appendEvent(event: WebLiveEvent, expiresAt?: string | null): number {
    this.pruneExpiredEventsIfDue();
    return appendRuntimeEvent(this.db, event, expiresAt);
  }

  appendLog(input: RuntimeLogEventPayload, expiresAt?: string | null): number {
    this.pruneExpiredEventsIfDue();
    return appendRuntimeLog(this.db, input, expiresAt);
  }

  appendQueueStatus(queue: RuntimeQueueStatus): number {
    this.pruneExpiredEventsIfDue();
    return appendRuntimeQueueStatus(this.db, queue);
  }

  latestEventId(): number {
    return latestRuntimeEventId(this.db);
  }

  pruneExpiredEvents(now = new Date()): number {
    return pruneRuntimeExpiredEvents(this.db, now);
  }

  eventsAfter(id: number, limit = 100): RuntimeEventRow[] {
    return runtimeEventsAfter(this.db, id, limit);
  }

  recentEvents(input: RuntimeEventPageInput = {}): RuntimeEventRow[] {
    return recentRuntimeEvents(this.db, input);
  }

  enqueueCommand(targetRole: RuntimeServiceRole, kind: string, payload: unknown = {}): string {
    return enqueueRuntimeCommand(this.db, targetRole, kind, payload);
  }

  commandById(id: string): RuntimeCommandRow | null {
    return runtimeCommandById(this.db, id);
  }

  recentCommands(limit = 100): RuntimeCommandRow[] {
    return recentRuntimeCommands(this.db, limit);
  }

  unfinishedCommands(): RuntimeCommandRow[] {
    return unfinishedRuntimeCommands(this.db);
  }

  claimCommand(id: string): RuntimeCommandRow | null {
    return claimRuntimeCommand(this.db, id);
  }

  claimPendingCommands(targetRole: RuntimeServiceRole, limit = 20): RuntimeCommandRow[] {
    return claimPendingRuntimeCommands(this.db, targetRole, limit);
  }

  completeCommand(id: string, status: Extract<RuntimeCommandStatus, "completed" | "failed">, detail?: unknown): void {
    completeRuntimeCommand(this.db, id, status, detail);
  }

  async waitForCommand(id: string, input: { timeoutMs?: number; pollMs?: number } = {}): Promise<CommandCompletion> {
    const timeoutMs = input.timeoutMs ?? 60_000;
    const pollMs = input.pollMs ?? 100;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const row = this.commandById(id);
      if (!row) return { ok: false, error: `Runtime command not found: ${id}` };
      if (row.status === "completed" || row.status === "failed") return completionFromRow(row);
      await Bun.sleep(pollMs);
    }
    return { ok: false, error: `Runtime command timed out after ${timeoutMs}ms: ${id}` };
  }

  heartbeat(
    role: RuntimeServiceRole,
    status: RuntimeServiceState | string,
    detail?: unknown,
    options?: { emitEvent?: boolean; pid?: number | null },
  ): void {
    this.pruneExpiredEventsIfDue();
    runtimeHeartbeat(this.db, role, status, detail, options);
  }

  service(role: RuntimeServiceRole): RuntimeServiceStatus | null {
    return runtimeService(this.db, role);
  }

  services(): RuntimeServiceStatus[] {
    return runtimeServices(this.db);
  }

  ensureGrant(capability: string, reason: string, scope = "global"): void {
    ensureRuntimeGrant(this.db, capability, reason, scope);
  }

  grantDecision(capability: string, scope = "global"): { allowed: boolean; reason: string } {
    return runtimeGrantDecision(this.db, capability, scope);
  }

  auditTool(input: ToolAuditInput): void {
    auditRuntimeTool(this.db, input);
  }

  createPermissionRequest(input: CreateSystemPermissionRequestInput): SystemPermissionRequest {
    return createRuntimePermissionRequest(this.db, input);
  }

  permissionRequest(id: string): SystemPermissionRequest | null {
    return runtimePermissionRequest(this.db, id);
  }

  pendingPermissionRequests(conversationId: string): SystemPermissionRequest[] {
    return pendingRuntimePermissionRequests(this.db, conversationId);
  }

  decidePermissionRequest(
    id: string,
    status: Extract<SystemPermissionStatus, "allowed" | "denied" | "timed_out">,
    reason: string,
  ): SystemPermissionRequest | null {
    return decideRuntimePermissionRequest(this.db, id, status, reason);
  }

  close(): void {
    this.db.close();
  }

  private pruneExpiredEventsIfDue(): void {
    const now = Date.now();
    if (now - this.lastExpiredEventPruneAt < EXPIRED_EVENT_PRUNE_INTERVAL_MS) return;
    this.lastExpiredEventPruneAt = now;
    this.pruneExpiredEvents(new Date(now));
  }
}
