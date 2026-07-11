import { isAiConfigured } from "../../src/config/validate";
import {
  localChatReady,
  localChatRequired,
  localInferenceDetail,
  localInferenceReady,
  localInferenceRequired,
} from "../../src/local-inference/status";
import {
  CURRENT_EMBEDDING_MODEL_ID,
  CURRENT_RANKING_MODEL_ID,
  DEFAULT_LOCAL_AGENT_MODEL_ID,
  selectedLocalAgentModelId,
} from "../../src/local-inference/manifest";
import {
  resolveHfHubCacheDir,
} from "../../src/local-inference/hf-cache";
import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { readAithyMcpServerToken, readMcpServerToken } from "../../src/settings/secrets";
import { RuntimeStore } from "../../src/runtime/runtime-store";
import { taskSummary } from "../../src/tasks/summary";
import { serializableMessage, serializablePermissionRequest } from "../../src/web/live-events";
import type { JsonValue, WebLiveEvent } from "../../src/web/live-events";
import {
  configDto,
  automationDto,
  memoryDto,
  memoryRunDto,
  notificationDto,
  profileDto,
  runtimeCapabilitiesDto,
  sandboxHealthFromService,
  sessionDto,
  skillDto,
  soulDto,
} from "./dto-mappers";
import {
  grokSubscriptionStatusDto,
  parallelSearchStatus,
  providerSecretStatuses,
  secretStatus,
  secretStatusForProvider,
} from "./secret.dto";
import { preloadExistingSessionMessagePage } from "./session-message-loading";
import { coreLocalModelDtos, defaultLocalModelDto, localModelDtos } from "./local-model-dtos";
import {
  MEMORIES_PAGE_SIZE,
  type ActivityDto,
  type AutomationsPageStateDto,
  type LocalInferencePageStateDto,
  type LocalInferenceStatusDto,
  type MeshPageStateDto,
  type MemoryPageStateDto,
  SKILLS_PAGE_SIZE,
  type NotificationsPageStateDto,
  type SettingsPageStateDto,
  type MessagePageDto,
  type SessionsPageStateDto,
  type SetupPageStateDto,
  type SetupGateStateDto,
  type SkillsPageStateDto,
  type ThemesPageStateDto,
  type TasksPageStateDto,
  type UsagePageStateDto,
  type WebStateDto,
} from "./dto-types";
import { notificationAttentionDto } from "./notification-attention";

const SERVICE_READY_FRESH_MS = 15_000;

export async function webStateDto(
  runtime: AithyRuntime,
  activeSessionId: string | null,
): Promise<WebStateDto> {
  if (!isSessionStateLoadedAll(runtime)) await runtime.sessionState.preloadAll();
  if (activeSessionId) {
    await preloadExistingSessionMessagePage(runtime, activeSessionId, { limit: 10 });
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
    activities: activeSessionId ? recentSessionActivities(runtime, activeSessionId) : [],
    pendingPermissions: activeSessionId ? pendingPermissionRequests(runtime, activeSessionId) : [],
    sessions: runtime.sessions.listSessions().map(sessionDto),
    settings,
    config: configDto(runtime.config, settings),
    secret: await secretStatus(runtime.config, settings),
    fastSecret: await fastSecretStatus(runtime, settings),
    providerSecrets: await providerSecretStatuses(runtime.config, settings),
    grokSubscription: await grokSubscriptionStatusDto(runtime.config),
    parallelSearch: await parallelSearchStatus(runtime.config, settings),
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
    notificationAttention: notificationAttentionDto(runtime),
    tasks: runtime.tasks.recent({ limit: 50 }).map(taskSummary),
    aiConfigured: isAiConfigured(runtime.config),
    runtimeCapabilities: runtimeCapabilitiesDto(),
    permissionRules: runtime.runtimeStore.listCapabilityPolicyRules(),
  };
}

function pendingPermissionRequests(
  runtime: AithyRuntime,
  conversationId: string,
) {
  const store = new RuntimeStore(runtime.config.stateDbPath);
  try {
    return store.pendingPermissionRequests(conversationId).map(serializablePermissionRequest);
  } finally {
    store.close();
  }
}

function recentSessionActivities(
  runtime: AithyRuntime,
  conversationId: string,
): ActivityDto[] {
  const store = new RuntimeStore(runtime.config.stateDbPath);
  try {
    return store.recentEvents({ kinds: ["activity"], limit: 100 })
      .map((row) => row.payload)
      .filter((event): event is Extract<WebLiveEvent, { type: "activity" }> =>
        event.type === "activity" && event.conversationId === conversationId
      )
      .map(activityDto)
      .reverse();
  } finally {
    store.close();
  }
}

function activityDto(event: Extract<WebLiveEvent, { type: "activity" }>): ActivityDto {
  return {
    type: "activity",
    id: event.id,
    conversationId: event.conversationId,
    createdAt: event.createdAt,
    ...(event.streamId ? { streamId: event.streamId } : {}),
    label: event.label,
    ...(event.detail === undefined ? {} : { detail: jsonValue(event.detail) }),
    ...(event.tone ? { tone: event.tone } : {}),
  };
}

function jsonValue(value: unknown): JsonValue {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function isSessionStateLoadedAll(runtime: AithyRuntime): boolean {
  const state = runtime.sessionState as { isLoadedAll?: () => boolean };
  return state.isLoadedAll?.() === true;
}

export function setupGateStateDto(runtime: AithyRuntime): SetupGateStateDto {
  const local = localInferenceStatusDto(runtime);
  return {
    aiConfigured: isAiConfigured(runtime.config),
    profileConfigured: Boolean(runtime.profile?.userName.trim()),
    localInferenceRequired: local.required,
    localInferenceReady: local.ready,
    localInferenceActive: local.active,
    localInferenceError: local.error,
  };
}

export function localInferenceStatusDto(runtime: AithyRuntime): LocalInferenceStatusDto {
  const chatRequired = localChatRequired(runtime.config);
  const service = runtime.runtimeStore.service("local-inference-worker");
  const detail = localInferenceDetail(service);
  const modelId = selectedLocalAgentModelId(runtime.config.localAgentModel ?? runtime.config.aiModel);
  const fresh = serviceStatusFresh(service);
  const routerReady = fresh && localInferenceReady(service);
  const chatReady = fresh && localChatReady(service, runtime.config);
  const ready = !chatRequired || chatReady;
  const error = fresh ? detail?.error ?? localInferenceServiceError(service) : null;
  return {
    required: chatRequired,
    routerRequired: localInferenceRequired(runtime.config),
    routerReady,
    chatRequired,
    chatReady,
    ready,
    active: chatRequired && !ready && !error,
    routerActive: !routerReady && !error,
    error,
    modelId,
    baseUrl: detail?.baseUrl ?? null,
    cacheDir: detail?.cacheDir ?? resolveHfHubCacheDir(),
    binaryPath: detail?.binaryPath ?? null,
    binarySource: detail?.binarySource ?? null,
    modelsIniPath: detail?.modelsIniPath ?? null,
    restartAttempt: detail?.restartAttempt,
    restartInMs: detail?.restartInMs,
    lastRouterExitCode: detail?.lastRouterExitCode,
    lastRouterExitAt: detail?.lastRouterExitAt,
    embeddingHealth: detail?.embeddingHealth ?? null,
  };
}

function serviceStatusFresh(
  service: ReturnType<AithyRuntime["runtimeStore"]["service"]>,
): boolean {
  if (!service) return false;
  const seenAt = Date.parse(service.lastSeenAt);
  return Number.isFinite(seenAt) && Date.now() - seenAt <= SERVICE_READY_FRESH_MS;
}

function localInferenceServiceError(
  service: ReturnType<AithyRuntime["runtimeStore"]["service"]>,
): string | null {
  if (service?.state !== "failed" && service?.state !== "degraded") return null;
  const detail = service.detail;
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.code === "number") return `local inference worker exited with code ${record.code}`;
  }
  return "local inference worker failed";
}

export async function setupPageStateDto(runtime: AithyRuntime): Promise<SetupPageStateDto> {
  const settings = runtime.settings.load();
  return {
    settings,
    config: configDto(runtime.config, settings),
    profile: profileDto(runtime.profile),
    providerSecrets: await providerSecretStatuses(runtime.config, settings),
    grokSubscription: await grokSubscriptionStatusDto(runtime.config),
    aiConfigured: isAiConfigured(runtime.config),
    runtimeCapabilities: runtimeCapabilitiesDto(),
    setupGate: setupGateStateDto(runtime),
    setupStatuses: recentSetupStatuses(runtime).filter((status) => status.key.startsWith("local.")),
  };
}

export function sessionsPageStateDto(runtime: AithyRuntime): SessionsPageStateDto {
  return {
    sessions: runtime.sessions.listSessions().map(sessionDto),
    settings: { ui: runtime.settings.load().ui },
  };
}

export function themesPageStateDto(runtime: AithyRuntime): ThemesPageStateDto {
  return { settings: runtime.settings.load() };
}

export function usagePageStateDto(runtime: AithyRuntime): UsagePageStateDto {
  return { settings: runtime.settings.load() };
}

export function memoryPageStateDto(runtime: AithyRuntime): MemoryPageStateDto {
  const memoriesPage = runtime.memory.page({ cursor: null, limit: MEMORIES_PAGE_SIZE });
  const mostRecent = runtime.memory.mostRecent();
  return {
    settings: runtime.settings.load(),
    memories: memoriesPage.items.map(memoryDto),
    memoriesCount: runtime.memory.count(),
    memoriesMostRecent: mostRecent ? { title: mostRecent.title } : null,
    memoriesNextCursor: memoriesPage.nextCursor,
    memoryRuns: runtime.memoryRuns.recent(50).map(memoryRunDto),
  };
}

export function skillsPageStateDto(runtime: AithyRuntime): SkillsPageStateDto {
  const skillsPage = runtime.skills.page({ cursor: null, limit: SKILLS_PAGE_SIZE, sort: "retrieved" });
  return {
    settings: runtime.settings.load(),
    skills: skillsPage.items.map(skillDto),
    skillsCount: runtime.skills.count(),
    skillsToolUniverse: runtime.skills.countDistinctTools(),
    skillsNextCursor: skillsPage.nextCursor,
  };
}

export async function settingsPageStateDto(runtime: AithyRuntime): Promise<SettingsPageStateDto> {
  const settings = runtime.settings.load();
  const config = configDto(runtime.config, settings);
  config.sandboxHealth = sandboxHealthFromService(runtime.runtimeStore.service("sandbox-worker"));
  return {
    settings,
    config,
    secret: await secretStatus(runtime.config, settings),
    fastSecret: await fastSecretStatus(runtime, settings),
    providerSecrets: await providerSecretStatuses(runtime.config, settings),
    grokSubscription: await grokSubscriptionStatusDto(runtime.config),
    parallelSearch: await parallelSearchStatus(runtime.config, settings),
    soul: soulDto(runtime.soul),
    profile: profileDto(runtime.profile),
    runtimeCapabilities: runtimeCapabilitiesDto(),
    permissionRules: runtime.runtimeStore.listCapabilityPolicyRules(),
    localModels: await localModelDtos(),
    mesh: runtime.mesh.snapshot(),
    meshInferenceProviders: runtime.mesh.snapshot().inferenceProviders,
    meshCatalogs: await runtime.mesh.liveCatalogs("all"),
    mcpStatus: {
      clients: Object.fromEntries(await Promise.all(Object.entries(settings.runtime.mcpServers ?? {}).map(async ([id, profile]) => [
        id, { profile, tokenConfigured: Boolean(await readMcpServerToken(id, runtime.config.botId)) },
      ]))),
      server: { ...runtime.mcpServer.status(), configured: Boolean(await readAithyMcpServerToken(runtime.config.botId)) },
    },
  };
}

export function meshPageStateDto(runtime: AithyRuntime): MeshPageStateDto {
  return {
    settings: runtime.settings.load(),
    mesh: runtime.mesh.snapshot(),
  };
}

export async function localInferencePageStateDto(
  runtime: AithyRuntime,
): Promise<LocalInferencePageStateDto> {
  const settings = runtime.settings.load();
  const localModels = await localModelDtos();
  const selectedLocalAgentModel = selectedLocalAgentModelId(runtime.config.localAgentModel ?? runtime.config.aiModel);
  return {
    settings,
    config: configDto(runtime.config, settings),
    status: localInferenceStatusDto(runtime),
    localModels,
    selectedLocalAgentModel,
    defaultLocalAgentModel: localModels.find((model) => model.id === DEFAULT_LOCAL_AGENT_MODEL_ID)
      ?? defaultLocalModelDto(false),
    coreModels: await coreLocalModelDtos(selectedLocalAgentModel, localModels),
    embeddingModel: CURRENT_EMBEDDING_MODEL_ID,
    rankingModel: CURRENT_RANKING_MODEL_ID,
    setupStatuses: recentSetupStatuses(runtime).filter((status) =>
      status.key.startsWith("local.") || status.key.startsWith("memory.")
    ),
  };
}

export function notificationsPageStateDto(runtime: AithyRuntime): NotificationsPageStateDto {
  return {
    notifications: runtime.notifications.recent(50).map(notificationDto),
    unreadNotifications: runtime.notifications.unreadCount(),
    notificationAttention: notificationAttentionDto(runtime),
  };
}

export function tasksPageStateDto(runtime: AithyRuntime): TasksPageStateDto {
  return {
    settings: runtime.settings.load(),
    tasks: runtime.tasks.recent({ limit: 100 }).map(taskSummary),
  };
}

export function automationsPageStateDto(runtime: AithyRuntime): AutomationsPageStateDto {
  return {
    settings: runtime.settings.load(),
    automations: runtime.automations.list().map((automation) => automationDto(automation, runtime.automations)),
    sessions: runtime.sessions.listSessions().map(sessionDto),
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

async function fastSecretStatus(runtime: AithyRuntime, settings: ReturnType<AithyRuntime["settings"]["load"]>) {
  if (!runtime.config.fastAiProvider) return null;
  return runtime.config.fastAiProvider === runtime.config.aiProvider
    ? secretStatus(runtime.config, settings)
    : secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId, settings);
}

function recentSetupStatuses(runtime: AithyRuntime): Array<Extract<WebLiveEvent, { type: "setup-status" }>> {
  const latest = new Map<string, Extract<WebLiveEvent, { type: "setup-status" }>>();
  const rows = runtime.runtimeStore.recentEvents({ kinds: ["setup-status"], limit: 100 }).reverse();
  for (const row of rows) {
    const event = row.payload;
    if (event.type !== "setup-status") continue;
    if (event.active || event.tone === "danger") latest.set(event.key, event);
    else latest.delete(event.key);
  }
  return [...latest.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

function emptyMessagePageDto(): MessagePageDto {
  return {
    items: [],
    oldestId: null,
    newestId: null,
    hasMoreBefore: false,
  };
}
