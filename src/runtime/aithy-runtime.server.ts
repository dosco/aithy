import path from "node:path";
import { mkdir } from "node:fs/promises";
import { SESSION_SWEEP_INTERVAL_MS } from "../config/limits";
import { ActiveRunRegistry } from "../agent/active-runs";
import { UserChatCommandProducer, type UserChatQueueClient } from "../agent/dispatcher";
import type { AppConfig } from "../config/env";
import { assertStartupConfig } from "../config/validate";
import { EventBus } from "../events/bus";
import { SqliteMemoryStore } from "../memory/memory-store";
import { SqliteMemoryRunsStore } from "../memory/memory-runs";
import { MemoryConsolidateProducer, type MemoryConsolidateHandle } from "../memory/consolidate-queue";
import { shutdownManager } from "bunqueue/client";
import { SqliteNotificationStore } from "../notifications/notification-store";
import type { NotificationCreate, NotificationEntry } from "../notifications/types";
import { SqliteUsageStore } from "../usage/usage-store";
import type { SandboxProvider } from "../sandbox/provider";
import { UnavailableSandboxProvider } from "../sandbox/unavailable-provider";
import { SessionManager } from "../session/session-manager";
import { seedSkillsIfEmpty } from "../skills/seed";
import { SqliteSkillsStore } from "../skills/skills-store";
import { SqliteSkillCandidateStore } from "../skills/candidate-store";
import { SqliteSkillPromotionStore } from "../skills/promote-store";
import { loadOrSeedSoul, saveSoul } from "../soul/service";
import { SqliteSoulStore } from "../soul/sqlite-soul-store";
import type { SoulFields, SoulProfile } from "../soul/types";
import { SqliteProfileStore } from "../profile/sqlite-profile-store";
import type { ProfileImageKind, StoredProfileImage, UserProfile, UserProfileFields } from "../profile/types";
import { LiveEventHub } from "../web/live-events";
import { globalMountsChanged } from "../settings/resolve";
import { SqliteSettingsStore } from "../settings/store";
import type { SettingsPatch, StoredSettings } from "../settings/types";
import { SqliteArtifactStore } from "../artifacts/artifact-store";
import { SqliteTaskStore } from "../tasks/task-store";
import { clearManagedProviderSecrets, removeBotStateDir, removeMicrosandboxVm, removeRuntimeCache, removeSqliteFiles } from "./reset-files";
import { describe, registerSignalHandlers } from "./signals";
import { assertSupportedBunVersion } from "./bun-version";
import { loadBaseConfig, resolveEffectiveConfig, type RuntimeSecretOverrides } from "./resolve-effective-config";
import { RuntimeServiceSupervisor } from "./supervisor/service-supervisor";
import { startQueueService, type QueueServiceHandle } from "./supervisor/queue-supervisor";
import { QueueServiceClient } from "./services/queue/client";
import { RemoteSessionStateStore } from "./services/queue/session-state-client";
import { RuntimeStore, type SystemPermissionRequest } from "./runtime-store";
import { permissionRequestEvent } from "../web/live-events";
import { ruleOptionForRequest } from "../security/permission-gate";
import type { CapabilityMatchKind } from "../security/capability-policy";
export interface AithyRuntime {
  config: AppConfig;
  events: EventBus;
  live: LiveEventHub;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  soul: SoulProfile;
  soulStore: SqliteSoulStore;
  profile?: UserProfile;
  settings: SqliteSettingsStore;
  skills: SqliteSkillsStore;
  artifacts: SqliteArtifactStore;
  memory: SqliteMemoryStore;
  notifications: SqliteNotificationStore;
  notify(input: NotificationCreate): NotificationEntry;
  usage: SqliteUsageStore;
  memoryRuns: SqliteMemoryRunsStore;
  memoryConsolidate: MemoryConsolidateHandle;
  skillCandidates: SqliteSkillCandidateStore;
  skillPromotions: SqliteSkillPromotionStore;
  activeRuns: ActiveRunRegistry;
  dispatcher: UserChatQueueClient;
  queue: QueueServiceClient;
  sessionState: RemoteSessionStateStore;
  runtimeStore: RuntimeStore;
  tasks: SqliteTaskStore;
  respondSystemPermission(
    requestId: string,
    decision: "allowed" | "denied",
    persist?: CapabilityMatchKind,
  ): SystemPermissionRequest;
  assertReady(): void;
  updateSettings(patch: SettingsPatch, secrets?: RuntimeSecretOverrides): Promise<StoredSettings>;
  updateSoul(fields: SoulFields): SoulProfile;
  updateProfile(fields: UserProfileFields): UserProfile;
  updateProfileImage(kind: ProfileImageKind, image: StoredProfileImage): UserProfile;
  clearProfileImage(kind: ProfileImageKind): UserProfile;
  shutdown(): Promise<void>;
  isShuttingDown(): boolean;
  isResetting(): boolean;
}

interface RuntimeGlobalState {
  runtimePromise?: Promise<AithyRuntime>;
  resetPromise?: Promise<AithyRuntime>;
}

type ViteHotContext = {
  dispose(callback: () => void): void;
};

const runtimeGlobal = globalThis as typeof globalThis & {
  __aithyRuntimeState?: RuntimeGlobalState;
};

function runtimeState(): RuntimeGlobalState {
  runtimeGlobal.__aithyRuntimeState ??= {};
  return runtimeGlobal.__aithyRuntimeState;
}

const hot = (import.meta as ImportMeta & { hot?: ViteHotContext }).hot;
if (hot) {
  hot.dispose(() => {
    const state = runtimeState();
    const runtimePromise = state.runtimePromise;
    state.runtimePromise = undefined;
    state.resetPromise = undefined;
    void runtimePromise?.then((runtime) => runtime.shutdown()).catch((error) => {
      console.error(`[hmr] failed to shut down runtime: ${describe(error)}`);
    });
  });
}

export function getAithyRuntime(): Promise<AithyRuntime> {
  const state = runtimeState();
  state.runtimePromise ??= RuntimeImpl.create();
  return state.runtimePromise;
}

export function resetAithyRuntimeSystem(): Promise<AithyRuntime> {
  const state = runtimeState();
  state.resetPromise ??= doResetAithyRuntimeSystem().finally(() => {
    state.resetPromise = undefined;
  });
  return state.resetPromise;
}
class RuntimeImpl implements AithyRuntime {
  private sweepTimer?: Timer;
  private shutdownPromise?: Promise<void>;
  private resetting = false;
  private storesClosed = false;
  private queueHandle?: QueueServiceHandle;
  private workerSupervisor?: RuntimeServiceSupervisor;

  private constructor(
    public config: AppConfig,
    public events: EventBus,
    public live: LiveEventHub,
    public sandbox: SandboxProvider,
    public sessions: SessionManager,
    public soul: SoulProfile,
    public soulStore: SqliteSoulStore,
    public profile: UserProfile | undefined,
    public profileStore: SqliteProfileStore,
    public settings: SqliteSettingsStore,
    public skills: SqliteSkillsStore,
    public artifacts: SqliteArtifactStore,
    public memory: SqliteMemoryStore,
    public memoryRuns: SqliteMemoryRunsStore,
    public memoryConsolidate: MemoryConsolidateHandle,
    public skillCandidates: SqliteSkillCandidateStore,
    public skillPromotions: SqliteSkillPromotionStore,
    public notifications: SqliteNotificationStore,
    public usage: SqliteUsageStore,
    public activeRuns: ActiveRunRegistry,
    public dispatcher: UserChatQueueClient,
    public queue: QueueServiceClient,
    public sessionState: RemoteSessionStateStore,
    public readonly runtimeStore: RuntimeStore,
    public readonly tasks: SqliteTaskStore,
  ) {}

  notify(input: NotificationCreate): NotificationEntry {
    const entry = this.notifications.push(input);
    this.live.publish({
      type: "notification",
      id: crypto.randomUUID(),
      createdAt: entry.createdAt,
      notification: {
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        body: entry.body,
        link: entry.link,
        createdAt: entry.createdAt,
      },
    });
    return entry;
  }
  static async create(): Promise<RuntimeImpl> {
    assertSupportedBunVersion();
    const baseConfig = loadBaseConfig();

    const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
    const config = await resolveEffectiveConfig(baseConfig, settings.load());

    const skills = new SqliteSkillsStore(config.stateDbPath);
    seedSkillsIfEmpty(skills);
    const skillPromotions = new SqliteSkillPromotionStore(config.stateDbPath);
    const skillCandidates = new SqliteSkillCandidateStore(config.stateDbPath);

    const events = new EventBus();
    const live = new LiveEventHub();
    events.subscribe((event) => live.publishBotEvent(event));
    const queueHandle = await startQueueService();
    const queue = queueHandle.client;
    queue.subscribe((event) => live.publish(event));
    const memory = new SqliteMemoryStore(config.stateDbPath);
    const artifacts = new SqliteArtifactStore(config.stateDbPath, config.workspaceRoot, config.outboxRoot);
    const memoryRuns = new SqliteMemoryRunsStore(config.stateDbPath);
    const notifications = new SqliteNotificationStore(config.stateDbPath);
    const usage = new SqliteUsageStore(config.stateDbPath);
    const runtimeStore = new RuntimeStore(config.stateDbPath);
    const tasks = new SqliteTaskStore(config.stateDbPath);

    const soulStore = new SqliteSoulStore(config.stateDbPath);
    const soul = loadOrSeedSoul(soulStore);
    const profileStore = new SqliteProfileStore(config.stateDbPath);
    const profile = profileStore.loadProfile();

    const sandbox = new UnavailableSandboxProvider();
    await mkdir(config.workspaceRoot, { recursive: true });
    await mkdir(config.outboxRoot, { recursive: true });
    const activeRuns = new ActiveRunRegistry();
    const sessionState = new RemoteSessionStateStore(queue);
    await sessionState.preloadAll();
    let runtimeRef: RuntimeImpl | null = null;
    const sessions = new SessionManager({
      sandbox,
      botId: config.botId,
      workspaceRoot: config.workspaceRoot,
      outboxRoot: config.outboxRoot,
      events,
      ttlMs: config.sessionTtlMs,
      idleParkMs: config.idleParkMs,
      state: sessionState,
      source: "web",
      activeRuns,
      globalMounts: config.globalMounts,
      persistGlobalMounts: (mounts) => {
        settings.save({ runtime: { globalMounts: mounts } });
        if (runtimeRef) {
          runtimeRef.config = { ...runtimeRef.config, globalMounts: mounts };
        }
      },
    });

    const memoryConsolidate = new MemoryConsolidateProducer(config.stateDbPath);
    const dispatcher = new UserChatCommandProducer(queue);

    const runtime = new RuntimeImpl(
      config,
      events,
      live,
      sandbox,
      sessions,
      soul,
      soulStore,
      profile,
      profileStore,
      settings,
      skills,
      artifacts,
      memory,
      memoryRuns,
      memoryConsolidate,
      skillCandidates,
      skillPromotions,
      notifications,
      usage,
      activeRuns,
      dispatcher,
      queue,
      sessionState,
      runtimeStore,
      tasks,
    );
    runtimeRef = runtime;
    runtime.queueHandle = queueHandle;
    await runtime.queue.heartbeat("web", "ready", { pid: process.pid });
    runtime.workerSupervisor = new RuntimeServiceSupervisor({
      queue,
      queueUrl: queueHandle.url,
      services: [
        { role: "agent-worker", entry: "src/runtime/services/agent/worker.ts" },
        { role: "sandbox-worker", entry: "src/runtime/services/sandbox/worker.ts" },
        { role: "embedding-worker", entry: "src/runtime/services/embedding/worker.ts" },
      ],
    });
    runtime.workerSupervisor.start();
    runtime.startSweep();
    registerSignalHandlers(runtime);
    return runtime;
  }

  assertReady(): void {
    if (this.resetting) throw new Error("Aithy is resetting. Try again in a moment.");
    assertStartupConfig(this.config);
  }

  respondSystemPermission(
    requestId: string,
    decision: "allowed" | "denied",
    persist?: CapabilityMatchKind,
  ): SystemPermissionRequest {
    const existing = this.runtimeStore.permissionRequest(requestId);
    if (!existing) throw new Error(`Permission request not found: ${requestId}`);
    if (existing.status !== "pending") return existing;
    if (decision === "allowed" && persist) {
      const option = ruleOptionForRequest(existing, persist);
      if (!option) throw new Error(`Permission request does not support ${persist}`);
      this.runtimeStore.createCapabilityPolicyRule({
        capability: existing.capability,
        matchKind: option.kind,
        matchValue: option.value,
        source: "permission_card",
        reason: `user allowed from permission prompt: ${existing.toolName}`,
      });
    }
    const request = this.runtimeStore.decidePermissionRequest(
      requestId,
      decision,
      decision === "allowed"
        ? persist ? `user allowed ${persist}` : "user allowed once"
        : "user denied",
    );
    if (!request) throw new Error(`Permission request not found: ${requestId}`);
    this.live.publish(permissionRequestEvent(request));
    return request;
  }

  async updateSettings(patch: SettingsPatch, secrets?: RuntimeSecretOverrides): Promise<StoredSettings> {
    const nextSettings = this.settings.save(patch);
    const nextConfig = await resolveEffectiveConfig(loadBaseConfig(), nextSettings, secrets);
    this.sessions.setTtlMs(nextConfig.sessionTtlMs);
    this.sessions.setIdleParkMs(nextConfig.idleParkMs);
    if (globalMountsChanged(this.config, nextConfig)) {
      this.sessions.setGlobalMounts(nextConfig.globalMounts);
    }
    this.config = nextConfig;
    await this.queue.submitCommand("agent-worker", "reload_settings");
    return nextSettings;
  }

  updateSoul(fields: SoulFields): SoulProfile {
    this.soul = saveSoul(this.soulStore, fields);
    return this.soul;
  }

  updateProfile(fields: UserProfileFields): UserProfile {
    this.profile = this.profileStore.saveProfile(fields);
    return this.profile;
  }

  updateProfileImage(kind: ProfileImageKind, image: StoredProfileImage): UserProfile {
    this.profile = this.profileStore.saveImage(kind, image);
    return this.profile;
  }

  clearProfileImage(kind: ProfileImageKind): UserProfile {
    this.profile = this.profileStore.clearImage(kind);
    return this.profile;
  }

  isShuttingDown(): boolean {
    return Boolean(this.shutdownPromise);
  }

  isResetting(): boolean {
    return this.resetting;
  }

  async prepareForFullReset(): Promise<void> {
    this.resetting = true;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.activeRuns.stopAll();
    await this.workerSupervisor?.close();
    await this.closeQueues();
    try {
      shutdownManager();
    } catch (error) {
      this.events.emit({
        type: "error",
        message: `[reset] bunqueue manager: ${describe(error)}`,
      });
    }
    await this.sessions.deleteAllSessions();
    await this.sessionState.flush();
    await this.queueHandle?.close();
    this.closeStores();
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.doShutdown();
    return this.shutdownPromise;
  }

  private async doShutdown(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.queue.beginShutdown();

    const stopped = this.activeRuns.stopAll();
    if (stopped > 0) {
      this.events.emit({ type: "error", message: `[shutdown] stopped ${stopped} active run(s)` });
    }
    await this.workerSupervisor?.close();

    await this.closeQueues();
    await this.sessionState.flush();
    await this.queueHandle?.close();

    try {
      shutdownManager();
    } catch (error) {
      this.events.emit({
        type: "error",
        message: `[shutdown] bunqueue manager: ${describe(error)}`,
      });
    }
    this.closeStores();
  }

  private startSweep(): void {
    this.sweepTimer = setInterval(() => {
      void this.sessions.sweepExpired().catch((error) => {
        this.events.emit({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to sweep sessions",
        });
      });
    }, SESSION_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  private async closeQueues(): Promise<void> {
    const queues = [
      ["dispatcher", this.dispatcher.close.bind(this.dispatcher)],
      ["memoryConsolidate", this.memoryConsolidate.close.bind(this.memoryConsolidate)],
    ] as const;
    for (const [name, close] of queues) {
      try {
        await close();
      } catch (error) {
        this.events.emit({
          type: "error",
          message: `[shutdown] ${name}.close failed: ${describe(error)}`,
        });
      }
    }
  }

  private closeStores(): void {
    if (this.storesClosed) return;
    this.storesClosed = true;
    this.sessions.closeState();
    this.soulStore.close();
    this.profileStore.close();
    this.settings.close();
    this.skills.close();
    this.artifacts.close();
    this.skillPromotions.close();
    this.skillCandidates.close();
    this.memory.close();
    this.memoryRuns.close();
    this.notifications.close();
    this.usage.close();
    this.runtimeStore.close();
    this.tasks.close();
  }
}
async function doResetAithyRuntimeSystem(): Promise<AithyRuntime> {
  const runtime = await getAithyRuntime();
  const impl = runtime as RuntimeImpl;
  await impl.prepareForFullReset();
  runtimeState().runtimePromise = undefined;
  await clearManagedProviderSecrets(impl.config.botId);
  await removeMicrosandboxVm(impl.config.botId);
  await removeBotStateDir(path.dirname(impl.config.stateDbPath), impl.config.botId);
  await removeRuntimeCache(path.join(path.dirname(impl.config.stateDbPath), "cache"));
  await removeSqliteFiles(impl.config.stateDbPath);
  await removeSqliteFiles(path.join(path.dirname(impl.config.stateDbPath), "bunqueue.db"));
  return getAithyRuntime();
}
