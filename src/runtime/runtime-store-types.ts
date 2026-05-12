import type {
  RuntimeLogLevel,
  RuntimeServiceRole,
} from "./protocol/types";
import type { WebLiveEvent } from "../web/live-events";

export type RuntimeCommandStatus = "pending" | "claimed" | "completed" | "failed";

export interface RuntimeEventRow {
  id: number;
  kind: string;
  conversationId: string | null;
  streamId: string | null;
  payload: WebLiveEvent;
  createdAt: string;
}

export interface RuntimeCommandRow {
  id: string;
  targetRole: RuntimeServiceRole;
  kind: string;
  payload: unknown;
  status: RuntimeCommandStatus;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  detail: unknown;
}

export interface RuntimeEventPageInput {
  kinds?: string[];
  role?: RuntimeServiceRole;
  level?: RuntimeLogLevel;
  search?: string;
  beforeId?: number | null;
  limit?: number;
}

export interface ToolAuditInput {
  conversationId?: string;
  capability: string;
  toolName: string;
  allowed: boolean;
  reason: string;
  argsPreview?: string;
}
