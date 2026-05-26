import type {
  SandboxBashRequest,
  SandboxBashResult,
  SandboxFile,
  SandboxSession,
  SessionMount,
} from "../../sandbox/provider";
import type { TargetIndexCounts } from "../../retrieval/indexing";

export const SERVICE_ROLES = [
  "web",
  "agent-worker",
  "sandbox-worker",
  "local-inference-worker",
  "queue-service",
] as const;

export type RuntimeServiceRole = typeof SERVICE_ROLES[number];
export type RuntimeServicePlacement = "process" | "coordinator";
export type RuntimeServiceState = "starting" | "ready" | "busy" | "degraded" | "stopping" | "failed";
export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";
export type QueueState = "idle" | "running" | "paused" | "blocked" | "failed";

export interface RuntimeServiceStatus {
  role: RuntimeServiceRole;
  state: RuntimeServiceState;
  pid: number | null;
  detail: unknown;
  lastSeenAt: string;
}

export interface RuntimeLogEventPayload {
  role: RuntimeServiceRole;
  level: RuntimeLogLevel;
  message: string;
  source?: string;
  detail?: unknown;
}

export interface RuntimeQueueStatus {
  id: string;
  ownerRole: RuntimeServiceRole;
  state: QueueState;
  depth?: number;
  activeCount?: number;
  blockedReason?: string;
  dependencyRoles?: RuntimeServiceRole[];
  updatedAt: string;
}

export type CommandCompletion<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string };

export type AgentCommandKind =
  | "enqueue_user_chat"
  | "stop_conversation"
  | "stop_all"
  | "reload_settings";

export type SandboxCommand =
  | {
      kind: "sandbox.createSession";
      payload: { botId: string; hostWorkspacePath: string; hostOutboxPath: string; mounts: SessionMount[] };
      result: SandboxSession;
    }
  | {
      kind: "sandbox.recreate";
      payload: { sessionId: string; hostWorkspacePath: string; hostOutboxPath: string; mounts: SessionMount[] };
      result: SandboxSession;
    }
  | {
      kind: "sandbox.bash";
      payload: { sessionId: string; request: SandboxBashRequest };
      result: SandboxBashResult;
    }
  | {
      kind: "sandbox.read";
      payload: { sessionId: string; path: string; maxBytes?: number };
      result: string;
    }
  | {
      kind: "sandbox.write";
      payload: { sessionId: string; path: string; content: string };
      result: SandboxFile;
    }
  | {
      kind: "sandbox.edit";
      payload: { sessionId: string; path: string; search: string; replace: string };
      result: SandboxFile;
    }
  | { kind: "sandbox.park"; payload: { sessionId: string }; result: void }
  | { kind: "sandbox.resume"; payload: { sessionId: string }; result: void }
  | { kind: "sandbox.destroy"; payload: { sessionId: string }; result: void }
  | { kind: "sandbox.reload_settings"; payload: Record<string, never>; result: void };

export type EmbeddingCommand =
  | { kind: "embedding.embedMany"; payload: { texts: string[] }; result: { vectors: number[][] } }
  | { kind: "embedding.embedQuery"; payload: { text: string }; result: { vector: number[] } }
  | { kind: "embedding.rerank"; payload: { query: string; docs: string[] }; result: { scores: number[] } }
  | { kind: "embedding.backfill_now"; payload: Record<string, never>; result: { done: number; skipped: number } }
  | {
      kind: "embedding.indexTargets";
      payload: { memories?: string[]; episodes?: string[]; skills?: string[] };
      result: { memories: TargetIndexCounts; episodes: TargetIndexCounts; skills: TargetIndexCounts };
    }
  | { kind: "embedding.reload_settings"; payload: Record<string, never>; result: void };

export type LocalInferenceCommand =
  | { kind: "local-inference.reload_settings"; payload: Record<string, never>; result: void }
  | { kind: "local-inference.status"; payload: Record<string, never>; result: unknown };

export type QueueControlCommandKind =
  | "queue.pause"
  | "queue.resume"
  | "queue.cancel_job"
  | "queue.retry_job"
  | "queue.inspect_job";

export type QueueControlCommand =
  | { kind: "queue.pause"; payload: { queueId: string; reason?: string }; result: RuntimeQueueStatus }
  | { kind: "queue.resume"; payload: { queueId: string }; result: RuntimeQueueStatus }
  | { kind: "queue.cancel_job"; payload: { queueId: string; jobId: string; reason?: string }; result: { cancelled: boolean } }
  | { kind: "queue.retry_job"; payload: { queueId: string; jobId: string }; result: { retried: boolean } }
  | { kind: "queue.inspect_job"; payload: { queueId: string; jobId: string }; result: { job: unknown } };

export function commandError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
