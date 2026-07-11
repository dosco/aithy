export type UsagePurpose =
  | "chat"
  | "memory.triage"
  | "memory.consolidate"
  | "memory.dream"
  | "skill.promote"
  | "skill.eval"
  | "playbook.update"
  | "other";

export interface UsageRecord {
  id: number;
  provider: string;
  model: string;
  purpose: UsagePurpose;
  component: string;
  stage: "ctx" | "task" | null;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  sessionId: string | null;
  runId: string | null;
  occurredAt: string;
}

export interface UsageInsert {
  provider: string;
  model: string;
  purpose: UsagePurpose;
  component?: string | null;
  stage?: "ctx" | "task" | null;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  sessionId?: string | null;
  runId?: string | null;
}

export interface UsageBucket {
  bucket: string; // ISO date (YYYY-MM-DD) or hour
  provider: string;
  model: string;
  purpose: UsagePurpose;
  component: string;
  stage: "ctx" | "task" | null;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  calls: number;
}
