import { isAiConfigured } from "../../src/config/validate";
import type { AithyRuntime } from "../../src/runtime/aithy-runtime.server";
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
  sessionDto,
  skillDto,
  soulDto,
} from "./dto-mappers";
import { parallelSearchStatus, secretStatus, secretStatusForProvider } from "./secret.dto";
import { preloadExistingSessionMessagePage } from "./session-message-loading";
import {
  MEMORIES_PAGE_SIZE,
  type ActivityDto,
  type AutomationsPageStateDto,
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
    config: configDto(runtime.config),
    secret: await secretStatus(runtime.config, settings),
    fastSecret: await fastSecretStatus(runtime, settings),
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
  return {
    aiConfigured: isAiConfigured(runtime.config),
    profileConfigured: Boolean(runtime.profile?.userName.trim()),
  };
}

export async function setupPageStateDto(runtime: AithyRuntime): Promise<SetupPageStateDto> {
  return {
    settings: runtime.settings.load(),
    config: configDto(runtime.config),
    profile: profileDto(runtime.profile),
    aiConfigured: isAiConfigured(runtime.config),
    runtimeCapabilities: runtimeCapabilitiesDto(),
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
  return {
    settings,
    config: configDto(runtime.config),
    secret: await secretStatus(runtime.config, settings),
    fastSecret: await fastSecretStatus(runtime, settings),
    parallelSearch: await parallelSearchStatus(runtime.config, settings),
    soul: soulDto(runtime.soul),
    profile: profileDto(runtime.profile),
    runtimeCapabilities: runtimeCapabilitiesDto(),
    permissionRules: runtime.runtimeStore.listCapabilityPolicyRules(),
  };
}

export function notificationsPageStateDto(runtime: AithyRuntime): NotificationsPageStateDto {
  return {
    notifications: runtime.notifications.recent(50).map(notificationDto),
    unreadNotifications: runtime.notifications.unreadCount(),
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
    : secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId);
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
