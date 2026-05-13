import type { AppConfig } from "../../src/config/env";
import type { BotSessionSummary } from "../../src/session/types";
import type { SoulProfile } from "../../src/soul/types";
import type { ProfileImage, UserProfile } from "../../src/profile/types";
import type { SkillEntry } from "../../src/skills/skills-store";
import type { MemoryEntry } from "../../src/memory/types";
import type { MemoryRun } from "../../src/memory/memory-runs";
import type { NotificationEntry } from "../../src/notifications/types";
import type { UsageBucket } from "../../src/usage/types";
import { serializableSession } from "../../src/web/live-events";
import type {
  ConfigDto,
  MemoryDto,
  MemoryRunDto,
  NotificationDto,
  ProfileDto,
  ProfileImageDto,
  RuntimeCapabilitiesDto,
  SessionSummaryDto,
  SkillDto,
  SoulDto,
  UsageBucketDto,
} from "./dto-types";

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
