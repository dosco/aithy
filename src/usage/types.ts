export type UsagePurpose =
  | "chat"
  | "memory.triage"
  | "memory.consolidate"
  | "skill.promote"
  | "other";

export interface UsageRecord {
  id: number;
  provider: string;
  model: string;
  purpose: UsagePurpose;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  sessionId: string | null;
  runId: string | null;
  occurredAt: string;
}

export interface UsageInsert {
  provider: string;
  model: string;
  purpose: UsagePurpose;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
  totalTokens?: number;
  sessionId?: string | null;
  runId?: string | null;
}

export interface UsageBucket {
  bucket: string; // ISO date (YYYY-MM-DD) or hour
  provider: string;
  model: string;
  purpose: UsagePurpose;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  calls: number;
}
