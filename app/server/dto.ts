import { loadConfig } from "../../src/config/env";
import type { AppConfig } from "../../src/config/env";
import type { BotSessionSummary } from "../../src/session/types";
import {
  serializableMessage,
  serializableSession,
  type SerializableBotMessage,
  type SerializableSessionSummary,
} from "../../src/web/live-events";
import { readProviderApiKey } from "../../src/settings/secrets";
import type { StoredSettings } from "../../src/settings/types";
import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import type { SoulProfile } from "../../src/soul/types";
import type { SkillEntry } from "../../src/skills/skills-store";
import type { MemoryEntry, MemoryKind } from "../../src/memory/types";
import type { MemoryRun, MemoryRunStatus, MemoryRunTrigger } from "../../src/memory/memory-runs";
import type { NotificationEntry, NotificationKind } from "../../src/notifications/types";
import type { UsageBucket, UsagePurpose } from "../../src/usage/types";

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
  traceEnabled: boolean;
  botId: string;
  stateDbPath: string;
  workspaceRoot: string;
  globalMounts: GlobalMountDto[];
}

export interface SecretStatusDto {
  provider: string;
  configured: boolean;
  source: "env" | "bun.secrets" | null;
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

export interface SkillDto {
  id: string;
  name: string;
  description: string;
  body: string;
  allowedTools: string | null;
  tags: string | null;
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
  tags: string | null;
  source: string | null;
  importance: number;
  createdAt: string;
  updatedAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
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

export interface NotificationDto {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export type SkillsCursor = { name: string; id: string };
export type MemoriesCursor = { updatedAt: string; id: string };

export const SKILLS_PAGE_SIZE = 60;
export const MEMORIES_PAGE_SIZE = 60;

export interface WebStateDto {
  activeSessionId: string | null;
  messages: SerializableBotMessage[];
  messagePage: MessagePageDto;
  sessions: SessionSummaryDto[];
  settings: StoredSettings;
  config: ConfigDto;
  secret: SecretStatusDto;
  fastSecret: SecretStatusDto | null;
  soul: SoulDto;
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
}

export function sessionDto(session: BotSessionSummary): SessionSummaryDto {
  return serializableSession(session);
}

export function configDto(config: AppConfig): ConfigDto {
  return {
    aiProvider: config.aiProvider,
    aiModel: config.aiModel ?? "",
    fastAiProvider: config.fastAiProvider ?? "",
    fastAiModel: config.fastAiModel ?? "",
    sandboxProvider: config.sandboxProvider,
    sandboxImage: config.sandboxImage,
    sandboxCpus: config.sandboxCpus,
    sandboxMemoryMb: config.sandboxMemoryMb,
    sandboxNetwork: config.sandboxNetwork,
    sessionTtlMs: config.sessionTtlMs,
    traceEnabled: config.traceEnabled,
    botId: config.botId,
    stateDbPath: config.stateDbPath,
    workspaceRoot: config.workspaceRoot,
    globalMounts: (config.globalMounts ?? []).map((m) => ({ hostPath: m.hostPath })),
  };
}

export function soulDto(soul: SoulProfile): SoulDto {
  return {
    name: soul.name,
    description: soul.description,
    coreNature: soul.coreNature,
    communicationStyle: soul.communicationStyle,
    behaviour: soul.behaviour,
    negativeBehavior: soul.negativeBehavior,
    responderDescription: soul.responderDescription,
    updatedAt: soul.updatedAt,
  };
}

export function notificationDto(entry: NotificationEntry): NotificationDto {
  return { ...entry };
}

export function usageBucketDto(bucket: UsageBucket): UsageBucketDto {
  return { ...bucket };
}

export function memoryRunDto(run: MemoryRun): MemoryRunDto {
  return { ...run };
}

export function memoryDto(entry: MemoryEntry): MemoryDto {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    tags: entry.tags,
    source: entry.source,
    importance: entry.importance,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastRecalledAt: entry.lastRecalledAt,
    recallCount: entry.recallCount,
  };
}

export function skillDto(skill: SkillEntry): SkillDto {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    allowedTools: skill.allowed_tools,
    tags: skill.tags,
    updatedAt: skill.updated_at,
  };
}

export async function webStateDto(
  runtime: AithyRuntime,
  activeSessionId: string | null,
): Promise<WebStateDto> {
  const skillsPage = runtime.skills.page({ cursor: null, limit: SKILLS_PAGE_SIZE });
  const memoriesPage = runtime.memory.page({ cursor: null, limit: MEMORIES_PAGE_SIZE });
  const mostRecent = runtime.memory.mostRecent();
  const messagePage = activeSessionId ? initialSessionMessagePage(runtime, activeSessionId) : emptyMessagePageDto();
  return {
    activeSessionId,
    messages: messagePage.items.map((item) => item.message),
    messagePage,
    sessions: runtime.sessions.listSessions().map(sessionDto),
    settings: runtime.settings.load(),
    config: configDto(runtime.config),
    secret: await secretStatus(runtime.config),
    fastSecret: runtime.config.fastAiProvider
      ? await secretStatusForProvider(runtime.config.fastAiProvider)
      : null,
    soul: soulDto(runtime.soul),
    skills: skillsPage.items.map(skillDto),
    skillsCount: runtime.skills.count(),
    skillsToolUniverse: runtime.skills.countDistinctTools(),
    skillsNextCursor: skillsPage.nextCursor,
    memories: memoriesPage.items.map(memoryDto),
    memoriesCount: runtime.memory.count(),
    memoriesMostRecent: mostRecent ? { title: mostRecent.title } : null,
    memoriesNextCursor: memoriesPage.nextCursor,
    memoryRuns: runtime.memoryRuns.recent(50).map(memoryRunDto),
    notifications: runtime.notifications.recent(50).map(notificationDto),
    unreadNotifications: runtime.notifications.unreadCount(),
  };
}

function initialSessionMessagePage(runtime: AithyRuntime, conversationId: string): MessagePageDto {
  const page = sessionMessagePageDto(runtime, conversationId, { limit: 10 });
  if (page.items.length > 0) return page;
  const transcript = runtime.sessions.getTranscript(conversationId).slice(-10);
  return {
    items: transcript.map((message, index) => ({
      id: `transcript-${message.createdAt}-${index}`,
      message: serializableMessage(message),
    })),
    oldestId: null,
    newestId: null,
    hasMoreBefore: false,
  };
}

export function sessionMessagePageDto(
  runtime: AithyRuntime,
  conversationId: string,
  input: { beforeId?: number | null; limit: number },
): MessagePageDto {
  const page = runtime.sessions.messagesPage(conversationId, input);
  return {
    ...page,
    items: page.items.map((item) => ({
      id: item.id,
      message: serializableMessage(item.message),
    })),
  };
}

function emptyMessagePageDto(): MessagePageDto {
  return {
    items: [],
    oldestId: null,
    newestId: null,
    hasMoreBefore: false,
  };
}

export async function secretStatus(config: AppConfig): Promise<SecretStatusDto> {
  return secretStatusForProvider(config.aiProvider);
}

export async function secretStatusForProvider(
  provider: string,
): Promise<SecretStatusDto> {
  const envConfig = loadConfig({
    ...process.env,
    AITHY_AI_PROVIDER: provider,
  });
  if (envConfig.aiApiKey) {
    return { provider, configured: true, source: "env" };
  }
  const secret = await readProviderApiKey(provider);
  return {
    provider,
    configured: Boolean(secret),
    source: secret ? "bun.secrets" : null,
  };
}
