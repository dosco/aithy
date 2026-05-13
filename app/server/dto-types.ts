import type { StoredSettings } from "../../src/settings/types";
import type { MemoryKind, MemoryLabel } from "../../src/memory/types";
import type { MemoryRunStatus, MemoryRunTrigger } from "../../src/memory/memory-runs";
import type { NotificationKind } from "../../src/notifications/types";
import type { UsagePurpose } from "../../src/usage/types";
import type { JsonValue, SerializableBotMessage, SerializableSessionSummary } from "../../src/web/live-events";

export type SessionSummaryDto = SerializableSessionSummary;

export interface GlobalMountDto {
  hostPath: string;
}

export interface ConfigDto {
  aiProvider: string;
  aiModel: string;
  fastAiProvider: string;
  fastAiModel: string;
  sandboxProvider: string;
  sandboxImage: string;
  sandboxCpus: number;
  sandboxMemoryMb: number;
  sandboxNetwork: string;
  sessionTtlMs: number;
  parallelAgents: number;
  traceEnabled: boolean;
  botId: string;
  stateDbPath: string;
  workspaceRoot: string;
  globalMounts: GlobalMountDto[];
}

export interface SecretStatusDto {
  provider: string;
  configured: boolean;
  source: "bun.secrets" | null;
}

export interface SoulDto {
  name: string;
  description: string;
  coreNature: string;
  communicationStyle: string;
  behaviour: string;
  negativeBehavior: string;
  responderDescription: string;
  updatedAt: string;
}

export interface ProfileImageDto {
  mimeType: string;
  width: number;
  height: number;
  updatedAt: string;
  dataUrl: string;
}

export interface ProfileDto {
  userName: string;
  userLocation: string;
  updatedAt: string;
  userPhoto: ProfileImageDto | null;
  agentPhoto: ProfileImageDto | null;
}

export interface RuntimeCapabilitiesDto {
  bunVersion: string;
}

export interface SkillDto {
  id: string;
  name: string;
  description: string;
  body: string;
  allowedTools: string | null;
  tags: string | null;
  retrievedCount: number;
  updatedAt: string;
}

export interface MemoryRunDto {
  id: string;
  sessionId: string;
  trigger: MemoryRunTrigger;
  status: MemoryRunStatus;
  startedAt: string;
  completedAt: string | null;
  msElapsed: number | null;
  summary: string | null;
  error: string | null;
  childSessionId: string | null;
}

export interface MemoryDto {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  labels: MemoryLabel[];
  validFrom: string | null;
  validUntil: string | null;
  durationDays: number | null;
  evidence: string | null;
  frequency: string | null;
  source: string | null;
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
  retrievedCount: number;
}

export interface UsageBucketDto {
  bucket: string;
  provider: string;
  model: string;
  purpose: UsagePurpose;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
  calls: number;
}

export interface UsageTotalsDto {
  callsAllTime: number;
  tokensAllTime: number;
  tokensLast24h: number;
  tokensLast7d: number;
}

export interface MessagePageDto {
  items: Array<{ id: number | string; message: SerializableBotMessage }>;
  oldestId: number | null;
  newestId: number | null;
  hasMoreBefore: boolean;
}

export interface ActivityDto {
  type: "activity";
  id: string;
  conversationId: string;
  createdAt: string;
  streamId?: string;
  label: string;
  detail?: JsonValue;
  tone?: "neutral" | "danger" | "success";
}

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export type SkillsCursor = { name: string; id: string; retrievedCount?: number };
export type MemoriesCursor = { updatedAt: string; id: string; retrievedCount?: number };

export const SKILLS_PAGE_SIZE = 60;
export const MEMORIES_PAGE_SIZE = 60;

export interface WebStateDto {
  activeSessionId: string | null;
  messages: SerializableBotMessage[];
  messagePage: MessagePageDto;
  activities: ActivityDto[];
  sessions: SessionSummaryDto[];
  settings: StoredSettings;
  config: ConfigDto;
  secret: SecretStatusDto;
  fastSecret: SecretStatusDto | null;
  soul: SoulDto;
  profile: ProfileDto;
  skills: SkillDto[];
  skillsCount: number;
  skillsToolUniverse: number;
  skillsNextCursor: SkillsCursor | null;
  memories: MemoryDto[];
  memoriesCount: number;
  memoriesMostRecent: { title: string } | null;
  memoriesNextCursor: MemoriesCursor | null;
  memoryRuns: MemoryRunDto[];
  notifications: NotificationDto[];
  unreadNotifications: number;
  aiConfigured: boolean;
  runtimeCapabilities: RuntimeCapabilitiesDto;
}

export interface SetupGateStateDto {
  aiConfigured: boolean;
  profileConfigured: boolean;
}

export type MemoryPageStateDto = Pick<
  WebStateDto,
  "settings" | "memories" | "memoriesCount" | "memoriesMostRecent" | "memoriesNextCursor" | "memoryRuns"
>;

export type SkillsPageStateDto = Pick<
  WebStateDto,
  "settings" | "skills" | "skillsCount" | "skillsToolUniverse" | "skillsNextCursor"
>;

export type SettingsPageStateDto = Pick<
  WebStateDto,
  "settings" | "config" | "secret" | "fastSecret" | "soul" | "profile" | "runtimeCapabilities"
>;

export type SetupPageStateDto = Pick<
  WebStateDto,
  "settings" | "config" | "profile" | "aiConfigured" | "runtimeCapabilities"
>;

export type ThemesPageStateDto = Pick<WebStateDto, "settings">;
export type UsagePageStateDto = Pick<WebStateDto, "settings">;
export type NotificationsPageStateDto = Pick<WebStateDto, "notifications" | "unreadNotifications">;

export interface SessionsPageStateDto {
  sessions: SessionSummaryDto[];
  settings: {
    ui: StoredSettings["ui"];
  };
}
