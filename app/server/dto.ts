import type { AppConfig } from "../../src/config/env";
import { isAiConfigured } from "../../src/config/validate";
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
import { hasNativeBunImage } from "../../src/profile/images";
import type { ProfileImage, UserProfile } from "../../src/profile/types";
import type { SkillEntry } from "../../src/skills/skills-store";
import type { MemoryEntry, MemoryKind, MemoryLabel } from "../../src/memory/types";
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
  profileImages: boolean;
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

export interface SessionsPageStateDto {
  sessions: SessionSummaryDto[];
  settings: {
    ui: StoredSettings["ui"];
  };
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
    parallelAgents: config.parallelAgents,
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

export function profileDto(profile: UserProfile | undefined): ProfileDto {
  return {
    userName: profile?.userName ?? "",
    userLocation: profile?.userLocation ?? "",
    updatedAt: profile?.updatedAt ?? "",
    userPhoto: profile?.userPhoto ? profileImageDto(profile.userPhoto) : null,
    agentPhoto: profile?.agentPhoto ? profileImageDto(profile.agentPhoto) : null,
  };
}

export function profileImageDto(image: ProfileImage): ProfileImageDto {
  return {
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    updatedAt: image.updatedAt,
    dataUrl: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}`,
  };
}

export function runtimeCapabilitiesDto(): RuntimeCapabilitiesDto {
  return {
    profileImages: hasNativeBunImage(),
    bunVersion: Bun.version,
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
    labels: entry.labels,
    validFrom: entry.validFrom,
    validUntil: entry.validUntil,
    durationDays: entry.durationDays,
    evidence: entry.evidence,
    frequency: entry.frequency,
    source: entry.source,
    importance: entry.importance,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastRecalledAt: entry.lastRecalledAt,
    recallCount: entry.recallCount,
    retrievedCount: entry.retrievedCount,
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
    retrievedCount: skill.retrieved_count,
    updatedAt: skill.updated_at,
  };
}


export async function webStateDto(
  runtime: AithyRuntime,
  activeSessionId: string | null,
): Promise<WebStateDto> {
  await runtime.sessionState.preloadAll();
  if (activeSessionId) {
    await runtime.sessionState.preloadSession(activeSessionId);
    await runtime.sessionState.preloadMessages(activeSessionId, { limit: 10 });
  }
  const settings = runtime.settings.load();
  const skillsPage = runtime.skills.page({ cursor: null, limit: SKILLS_PAGE_SIZE, sort: "retrieved" });
  const memoriesPage = runtime.memory.page({ cursor: null, limit: MEMORIES_PAGE_SIZE });
  const mostRecent = runtime.memory.mostRecent();
  const messagePage = activeSessionId ? initialSessionMessagePage(runtime, activeSessionId) : emptyMessagePageDto();
  return {
    activeSessionId,
    messages: messagePage.items.map((item) => item.message),
    messagePage,
    sessions: runtime.sessions.listSessions().map(sessionDto),
    settings,
    config: configDto(runtime.config),
    secret: await secretStatus(runtime.config, settings),
    fastSecret: runtime.config.fastAiProvider
      ? runtime.config.fastAiProvider === runtime.config.aiProvider
        ? await secretStatus(runtime.config, settings)
        : await secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId)
      : null,
    soul: soulDto(runtime.soul),
    profile: profileDto(runtime.profile),
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
    aiConfigured: isAiConfigured(runtime.config),
    runtimeCapabilities: runtimeCapabilitiesDto(),
  };
}

export function setupGateStateDto(runtime: AithyRuntime): SetupGateStateDto {
  return {
    aiConfigured: isAiConfigured(runtime.config),
    profileConfigured: Boolean(runtime.profile?.userName.trim()),
  };
}

export function sessionsPageStateDto(runtime: AithyRuntime): SessionsPageStateDto {
  return {
    sessions: runtime.sessions.listSessions().map(sessionDto),
    settings: { ui: runtime.settings.load().ui },
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

export async function secretStatus(
  config: AppConfig,
  settings?: StoredSettings,
): Promise<SecretStatusDto> {
  if (settings?.runtime.aiApiKey === null) {
    return { provider: config.aiProvider, configured: false, source: null };
  }
  return secretStatusForProvider(config.aiProvider, config.botId);
}

export async function secretStatusForProvider(
  provider: string,
  botId: string,
): Promise<SecretStatusDto> {
  const secret = await readProviderApiKey(provider, botId);
  return {
    provider,
    configured: Boolean(secret),
    source: secret ? "bun.secrets" : null,
  };
}
