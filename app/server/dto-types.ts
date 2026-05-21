import type { StoredSettings } from "../../src/settings/types";
import type { LocalInferenceSettings } from "../../src/local-inference/settings";
import type { MemoryKind } from "../../src/memory/types";
import type { MemoryRunStatus, MemoryRunTrigger } from "../../src/memory/memory-runs";
import type { NotificationKind } from "../../src/notifications/types";
import type { UsagePurpose } from "../../src/usage/types";
import type { CapabilityPolicyRule } from "../../src/security/capability-policy";
import type { TaskSummary } from "../../src/tasks/types";
import type {
  AutomationAttentionType,
  AutomationCreatedSource,
  AutomationNotificationPolicy,
  AutomationRunStatus,
  AutomationStatus,
} from "../../src/automations/types";
import type {
  JsonValue,
  SerializableBotMessage,
  SerializableSessionSummary,
  SerializableSystemPermissionRequest,
  WebLiveEvent,
} from "../../src/web/live-events";

export type SessionSummaryDto = SerializableSessionSummary;

export interface GlobalMountDto {
  hostPath: string;
}

export interface ConfigDto {
  aiProvider: string;
  aiApiUrl: string;
  aiModel: string;
  localAgentModel: string;
  localInference: LocalInferenceSettings;
  fastAiProvider: string;
  fastAiApiUrl: string;
  fastAiModel: string;
  sandboxProvider: string;
  sandboxImage: string;
  sandboxCpus: number;
  sandboxMemoryMb: number;
  sandboxNetwork: string;
  sessionTtlMs: number;
  parallelAgents: number;
  parallelSearchMcpUrl: string;
  grokSubscriptionConnected?: boolean;
  systemBashEnabled: boolean;
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

export interface ParallelSearchStatusDto extends SecretStatusDto {
  provider: "parallel" | "grok-subscription";
  mode: "anonymous" | "api-key" | "grok-subscription";
  url: string;
}

export interface ParallelSearchTestDto {
  provider: "parallel" | "grok-subscription";
  mode: "anonymous" | "api-key" | "grok-subscription";
  url: string;
  answer: string;
}

export interface GrokSubscriptionStatusDto {
  connected: boolean;
  state: "disconnected" | "connected" | "signing_in" | "needs_reauth" | "tier_denied" | "error";
  message: string | null;
  updatedAt: string | null;
  lastConnectedAt: string | null;
  expiresAt: string | null;
}

export interface GrokSubscriptionLoginStartDto {
  loginId: string;
  authorizeUrl: string;
  redirectUri: string;
  status: GrokSubscriptionStatusDto;
}

export interface GrokSubscriptionLoginPollDto {
  loginId: string;
  state: GrokSubscriptionStatusDto["state"];
  message: string;
  status: GrokSubscriptionStatusDto;
  config: ConfigDto;
  secret: SecretStatusDto;
  fastSecret: SecretStatusDto | null;
  parallelSearch: ParallelSearchStatusDto;
  aiConfigured: boolean;
  setupGate: SetupGateStateDto;
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

export interface LocalModelDto {
  id: string;
  repoId: string;
  filename: string;
  displayName: string;
  alias?: string;
  role?: string;
  path: string;
  sizeBytes: number;
  managed: boolean;
  cached: boolean;
}

export interface LocalInferenceStatusDto {
  required: boolean;
  routerRequired: boolean;
  routerReady: boolean;
  routerActive: boolean;
  chatRequired: boolean;
  chatReady: boolean;
  ready: boolean;
  active: boolean;
  error: string | null;
  modelId: string;
  baseUrl: string | null;
  cacheDir: string;
  binaryPath: string | null;
  binarySource: string | null;
  modelsIniPath: string | null;
}

export type PermissionRuleDto = CapabilityPolicyRule;

export interface SkillDto {
  id: string;
  name: string;
  description: string;
  whenToUse: string | null;
  body: string;
  allowedTools: string | null;
  tags: string | null;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  files: SkillFileDto[];
  links: string[];
  recentUsage: SkillUsageDto[];
  retrievedCount: number;
  usedCount: number;
  lastRetrievedAt: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
}

export interface SkillFileDto {
  path: string;
  content: string;
  bytes: number;
  updatedAt: string;
}

export interface SkillUsageDto {
  reason: string | null;
  stage: string | null;
  createdAt: string;
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
  cacheCreationTokens: number;
  cacheReadTokens: number;
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

export type TaskDto = TaskSummary;

export interface AutomationRunDto {
  id: string;
  automationId: string;
  runSessionId: string | null;
  taskId: string | null;
  status: AutomationRunStatus;
  triggeredAt: string;
  scheduledFor: string;
  resultSummary: string | null;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface AutomationDto {
  id: string;
  status: AutomationStatus;
  attentionType: AutomationAttentionType;
  title: string;
  prompt: string;
  schedule: string;
  scheduleKind: "cron" | "interval" | "once";
  scheduleRunAt: string | null;
  timezone: string;
  notificationPolicy: AutomationNotificationPolicy;
  originSessionId: string;
  createdSource: AutomationCreatedSource;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  recentRuns: AutomationRunDto[];
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
  pendingPermissions: SerializableSystemPermissionRequest[];
  sessions: SessionSummaryDto[];
  settings: StoredSettings;
  config: ConfigDto;
  secret: SecretStatusDto;
  fastSecret: SecretStatusDto | null;
  grokSubscription: GrokSubscriptionStatusDto;
  parallelSearch: ParallelSearchStatusDto;
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
  tasks: TaskDto[];
  aiConfigured: boolean;
  runtimeCapabilities: RuntimeCapabilitiesDto;
  permissionRules: PermissionRuleDto[];
}

export interface SetupGateStateDto {
  aiConfigured: boolean;
  profileConfigured: boolean;
  localInferenceRequired: boolean;
  localInferenceReady: boolean;
  localInferenceActive: boolean;
  localInferenceError: string | null;
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
  "settings" | "config" | "secret" | "fastSecret" | "parallelSearch" | "soul" | "profile" | "runtimeCapabilities"
  | "permissionRules" | "grokSubscription"
> & { localModels: LocalModelDto[] };

export type SetupPageStateDto = Pick<
  WebStateDto,
  "settings" | "config" | "profile" | "aiConfigured" | "runtimeCapabilities" | "grokSubscription"
> & {
  setupGate: SetupGateStateDto;
  setupStatuses: Array<Extract<WebLiveEvent, { type: "setup-status" }>>;
};

export type ThemesPageStateDto = Pick<WebStateDto, "settings">;
export type UsagePageStateDto = Pick<WebStateDto, "settings">;
export type NotificationsPageStateDto = Pick<WebStateDto, "notifications" | "unreadNotifications">;

export type TasksPageStateDto = Pick<WebStateDto, "tasks" | "settings">;

export interface LocalInferencePageStateDto {
  settings: StoredSettings;
  config: ConfigDto;
  status: LocalInferenceStatusDto;
  localModels: LocalModelDto[];
  selectedLocalAgentModel: string;
  defaultLocalAgentModel: LocalModelDto;
  coreModels: LocalModelDto[];
  embeddingModel: string;
  rankingModel: string;
  setupStatuses: Array<Extract<WebLiveEvent, { type: "setup-status" }>>;
}

export interface AutomationsPageStateDto {
  settings: StoredSettings;
  automations: AutomationDto[];
  sessions: SessionSummaryDto[];
}

export interface SessionsPageStateDto {
  sessions: SessionSummaryDto[];
  settings: {
    ui: StoredSettings["ui"];
  };
}
