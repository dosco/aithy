import type { SkillFileInput } from "./bundle";

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  when_to_use: string | null;
  allowed_tools: string | null;
  tags: string | null;
  body: string;
  files: SkillFileEntry[];
  links: string[];
  recent_usage: SkillUsageEvent[];
  retrieved_count: number;
  used_count: number;
  disable_model_invocation: boolean;
  user_invocable: boolean;
  last_retrieved_at: string | null;
  last_used_at: string | null;
  updated_at: string;
}

export interface SkillUpsert {
  id: string;
  name: string;
  description: string;
  whenToUse?: string | null;
  body: string;
  allowedTools: string | null;
  tags: string | null;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  files?: readonly SkillFileInput[];
}

export interface SkillFileEntry extends SkillFileInput {
  content_hash: string;
  bytes: number;
  updated_at: string;
}

export type SkillEventType = "loaded" | "used";
export type SkillMatchKind = "id" | "name" | "search";

export interface SkillUsageEvent {
  id: number;
  event_type: SkillEventType;
  skill_id: string;
  session_id: string | null;
  task_id: string | null;
  stage: string | null;
  reason: string | null;
  query: string | null;
  match_kind: string | null;
  queries: string[];
  created_at: string;
}

export interface SkillEventInput {
  eventType: SkillEventType;
  skillId: string;
  sessionId?: string | null;
  taskId?: string | null;
  stage?: string | null;
  reason?: string | null;
  query?: string | null;
  matchKind?: SkillMatchKind | string | null;
  queries?: readonly string[];
}

export interface SkillResolvedMatch {
  skill: SkillEntry;
  query: string;
  matchKind: SkillMatchKind;
}
