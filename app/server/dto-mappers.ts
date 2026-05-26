import type { AppConfig } from "../../src/config/env";
import type { BotSessionSummary } from "../../src/session/types";
import type { SoulProfile } from "../../src/soul/types";
import type { ProfileImage, UserProfile } from "../../src/profile/types";
import type { SkillEntry } from "../../src/skills/skills-store";
import type { MemoryEntry } from "../../src/memory/types";
import type { MemoryRun } from "../../src/memory/memory-runs";
import type { NotificationEntry } from "../../src/notifications/types";
import type { UsageBucket } from "../../src/usage/types";
import type { TrainingDataSummary } from "../../src/training-data/types";
import type { AutomationRecord, AutomationRunRecord } from "../../src/automations/types";
import type { SqliteAutomationStore } from "../../src/automations/store";
import { serializableSession } from "../../src/web/live-events";
import type {
  ConfigDto,
  MemoryDto,
  MemoryRunDto,
  ProfileDto,
  ProfileImageDto,
  RuntimeCapabilitiesDto,
  SessionSummaryDto,
  SkillDto,
  SoulDto,
  UsageBucketDto,
  AutomationDto,
  AutomationRunDto,
} from "./dto-types";
import type { NotificationDto } from "./notification.dto-types";
import type { TrainingDataSummaryDto } from "./training-data.dto";
import type { StoredSettings } from "../../src/settings/types";
import { resolveSandboxImageConfig } from "../../src/sandbox/image-catalog";
import type { RuntimeServiceStatus } from "../../src/runtime/protocol/types";

export function sessionDto(session: BotSessionSummary): SessionSummaryDto {
  return serializableSession(session);
}

export function configDto(config: AppConfig, settings?: StoredSettings): ConfigDto {
  const sandboxImage = resolveSandboxImageConfig({
    sandboxImageSelection: config.sandboxImageSelection,
    customSandboxImages: config.customSandboxImages,
    sandboxImage: config.sandboxImage,
  });
  return {
    aiProvider: config.aiProvider,
    aiApiUrl: config.aiApiUrl ?? "",
    aiModel: config.aiModel ?? "",
    localAgentModel: config.localAgentModel ?? "",
    localInference: config.localInference,
    fastAiProvider: config.fastAiProvider ?? "",
    fastAiApiUrl: config.fastAiApiUrl ?? "",
    fastAiModel: config.fastAiModel ?? "",
    sandboxProvider: config.sandboxProvider,
    sandboxImage: config.sandboxImage,
    sandboxImageLabel: config.sandboxImageLabel ?? sandboxImage.label,
    sandboxImageSelection: config.sandboxImageSelection ?? sandboxImage.selection,
    customSandboxImages: config.customSandboxImages ?? sandboxImage.customImages,
    sandboxImageOptions: config.sandboxImageOptions ?? sandboxImage.options,
    sandboxHealth: null,
    sandboxCpus: config.sandboxCpus,
    sandboxMemoryMb: config.sandboxMemoryMb,
    sandboxNetwork: config.sandboxNetwork,
    sessionTtlMs: config.sessionTtlMs,
    parallelAgents: config.parallelAgents,
    searchProvider: config.searchProvider ?? "parallel",
    searchApiUrl: config.searchApiUrl ?? "",
    parallelSearchMcpUrl: config.parallelSearchMcpUrl,
    grokSubscriptionConnected: config.grokSubscriptionConnected ?? false,
    systemBashEnabled: config.systemBashEnabled,
    trainingDataCaptureEnabled: config.trainingDataCaptureEnabled,
    traceEnabled: config.traceEnabled,
    botId: config.botId,
    stateDbPath: config.stateDbPath,
    workspaceRoot: config.workspaceRoot,
    globalMounts: (config.globalMounts ?? []).map((m) => ({ hostPath: m.hostPath, mode: m.mode ?? "read-only" })),
    aiProviderProfiles: settings?.runtime.aiProviderProfiles ?? {},
    searchProviderProfiles: settings?.runtime.searchProviderProfiles ?? {},
  };
}

export function sandboxHealthFromService(service: RuntimeServiceStatus | null | undefined): ConfigDto["sandboxHealth"] {
  const detail = service?.detail;
  if (!detail || typeof detail !== "object") return null;
  const health = (detail as { health?: unknown }).health;
  return health && typeof health === "object" ? health as ConfigDto["sandboxHealth"] : null;
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

export function automationDto(entry: AutomationRecord, store: SqliteAutomationStore): AutomationDto {
  return {
    ...entry,
    schedule: entry.schedule.human,
    scheduleKind: entry.schedule.kind,
    scheduleRunAt: entry.schedule.kind === "once" ? entry.schedule.runAt : null,
    recentRuns: store.recentRuns(entry.id, 6).map(automationRunDto),
  };
}

export function automationRunDto(entry: AutomationRunRecord): AutomationRunDto {
  return { ...entry };
}

export function usageBucketDto(bucket: UsageBucket): UsageBucketDto {
  return { ...bucket };
}

export function trainingDataSummaryDto(
  summary: TrainingDataSummary,
  captureEnabled: boolean,
): TrainingDataSummaryDto {
  return {
    captureEnabled,
    ...summary,
  };
}

export function memoryRunDto(run: MemoryRun): MemoryRunDto {
  return { ...run };
}

export function memoryDto(entry: MemoryEntry): MemoryDto {
  return {
    id: entry.id,
    kind: entry.kind,
    subject: entry.subject,
    scopeKind: entry.scopeKind,
    scopeRef: entry.scopeRef,
    guidance: entry.guidance,
    title: entry.title,
    body: entry.body,
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
    whenToUse: skill.when_to_use,
    body: skill.body,
    allowedTools: skill.allowed_tools,
    requiredSandboxCapabilities: skill.required_sandbox_capabilities,
    tags: skill.tags,
    disableModelInvocation: skill.disable_model_invocation,
    userInvocable: skill.user_invocable,
    sourceKind: skill.source_kind,
    sourceId: skill.source_id,
    sourceVersion: skill.source_version,
    sourceHash: skill.source_hash,
    disabledAt: skill.disabled_at,
    duplicatedFromSourceId: skill.duplicated_from_source_id,
    files: skill.files.map((file) => ({
      path: file.path,
      content: file.content,
      bytes: file.bytes,
      updatedAt: file.updated_at,
    })),
    links: skill.links,
    recentUsage: skill.recent_usage.map((event) => ({
      reason: event.reason,
      stage: event.stage,
      createdAt: event.created_at,
    })),
    retrievedCount: skill.retrieved_count,
    usedCount: skill.used_count,
    lastRetrievedAt: skill.last_retrieved_at,
    lastUsedAt: skill.last_used_at,
    updatedAt: skill.updated_at,
  };
}
