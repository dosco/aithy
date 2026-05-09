import path from "node:path";
import { SESSION_SWEEP_INTERVAL_MS } from "../config/limits";
import { ActiveRunRegistry } from "../agent/active-runs";
import { loadConfig, type AppConfig } from "../config/env";
import { assertStartupConfig } from "../config/validate";
import { EventBus } from "../events/bus";
import { EmbedService } from "../memory/embed";
import { SqliteMemoryStore } from "../memory/memory-store";
import { SqliteMemoryRunsStore } from "../memory/memory-runs";
import { MemoryQueue } from "../memory/memory-queue";
import { MemoryConsolidateQueue } from "../memory/consolidate-queue";
import { RerankerService } from "../memory/rerank";
import { probeAndConfigureSqlite } from "../memory/vec-extension";
import { shutdownManager } from "bunqueue/client";
import { SqliteNotificationStore } from "../notifications/notification-store";
import type { NotificationCreate, NotificationEntry } from "../notifications/types";
import { SqliteUsageStore } from "../usage/usage-store";
import { createSandboxProvider } from "../sandbox/create-provider";
import type { SandboxProvider } from "../sandbox/provider";
import { SessionManager } from "../session/session-manager";
import { SqliteSessionStateStore } from "../session/sqlite-state-store";
import { seedSkillsIfEmpty } from "../skills/seed";
import { SqliteSkillsStore } from "../skills/skills-store";
import { SkillPromoteQueue } from "../skills/promote-queue";
import { loadOrSeedSoul, saveSoul } from "../soul/service";
import { SqliteSoulStore } from "../soul/sqlite-soul-store";
import type { SoulFields, SoulProfile } from "../soul/types";
import { WorkspaceStore } from "../workspace/store";
import { LiveEventHub } from "../web/live-events";
import {
  applyRuntimeSettings,
  globalMountsChanged,
  runtimeSandboxChanged,
} from "../settings/resolve";
import { readProviderApiKey } from "../settings/secrets";
import { SqliteSettingsStore } from "../settings/store";
import type { SettingsPatch, StoredSettings } from "../settings/types";
import { clearManagedProviderSecrets, removeSqliteFiles } from "./reset-files";
import { describe, registerSignalHandlers } from "./signals";

export interface AithyRuntime {
  config: AppConfig;
  events: EventBus;
  live: LiveEventHub;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  soul: SoulProfile;
  soulStore: SqliteSoulStore;
  workspaces: WorkspaceStore;
  settings: SqliteSettingsStore;
  skills: SqliteSkillsStore;
  memory: SqliteMemoryStore;
  notifications: SqliteNotificationStore;
  notify(input: NotificationCreate): NotificationEntry;
  usage: SqliteUsageStore;
  memoryRuns: SqliteMemoryRunsStore;
  memoryQueue: MemoryQueue;
  memoryConsolidate: MemoryConsolidateQueue;
  skillPromote: SkillPromoteQueue;
  activeRuns: ActiveRunRegistry;
  assertReady(): void;
  updateSettings(patch: SettingsPatch): Promise<StoredSettings>;
  updateSoul(fields: SoulFields): SoulProfile;
  shutdown(): Promise<void>;
  isShuttingDown(): boolean;
  isResetting(): boolean;
}

let runtimePromise: Promise<RuntimeImpl> | undefined;
let resetPromise: Promise<AithyRuntime> | undefined;

export function getAithyRuntime(): Promise<AithyRuntime> {
  runtimePromise ??= RuntimeImpl.create();
  return runtimePromise;
}

export function resetAithyRuntimeSystem(): Promise<AithyRuntime> {
  resetPromise ??= doResetAithyRuntimeSystem().finally(() => {
    resetPromise = undefined;
  });
  return resetPromise;
}

class RuntimeImpl implements AithyRuntime {
  private sweepTimer?: Timer;
  private shutdownPromise?: Promise<void>;
  private resetting = false;

  private constructor(
    public config: AppConfig,
    public events: EventBus,
    public live: LiveEventHub,
    public sandbox: SandboxProvider,
    public sessions: SessionManager,
    public soul: SoulProfile,
    public soulStore: SqliteSoulStore,
    public workspaces: WorkspaceStore,
    public settings: SqliteSettingsStore,
    public skills: SqliteSkillsStore,
    public memory: SqliteMemoryStore,
    public memoryRuns: SqliteMemoryRunsStore,
    public memoryQueue: MemoryQueue,
    public memoryConsolidate: MemoryConsolidateQueue,
    public skillPromote: SkillPromoteQueue,
    public notifications: SqliteNotificationStore,
    public usage: SqliteUsageStore,
    public activeRuns: ActiveRunRegistry,
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
    const baseConfig = loadConfig(process.env, {
      traceEnabled: process.argv.includes("--trace"),
    });

    const vecState = probeAndConfigureSqlite();

    const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
    const config = await resolveEffectiveConfig(baseConfig, settings.load());

    const skills = new SqliteSkillsStore(config.stateDbPath);
    seedSkillsIfEmpty(skills);

    const stateRoot = path.dirname(config.stateDbPath);
    const embedder = new EmbedService({
      cacheDir: path.join(stateRoot, "cache"),
      log: (msg) => console.log(`[memory] ${msg}`),
    });
    const reranker = new RerankerService({
      cacheDir: path.join(stateRoot, "cache"),
      log: (msg) => console.log(`[memory] ${msg}`),
    });

    const memory = new SqliteMemoryStore(config.stateDbPath, {
      embedder,
      reranker,
      log: (msg) => console.log(`[memory] ${msg}`),
    });
    const memoryRuns = new SqliteMemoryRunsStore(config.stateDbPath);
    const notifications = new SqliteNotificationStore(config.stateDbPath);
    const usage = new SqliteUsageStore(config.stateDbPath);

    const soulStore = new SqliteSoulStore(config.stateDbPath);
    const soul = loadOrSeedSoul(soulStore);

    const events = new EventBus();
    const live = new LiveEventHub();
    events.subscribe((event) => live.publishBotEvent(event));

    const sandbox = createSandboxProvider(config);
    const workspaces = new WorkspaceStore(config.workspaceRoot);
    const activeRuns = new ActiveRunRegistry();
    let runtimeRef: RuntimeImpl | null = null;
    const sessions = new SessionManager({
      sandbox,
      workspaces,
      events,
      ttlMs: config.sessionTtlMs,
      idleParkMs: config.idleParkMs,
      maxLiveSandboxes: config.maxLiveSandboxes,
      state: new SqliteSessionStateStore(config.stateDbPath),
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

    const pushNotification = (input: NotificationCreate) => {
      const entry = notifications.push(input);
      live.publish({
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
    };

    const postToSubSession = (input: {
      parentSessionId: string;
      parentMessageId?: number | null;
      text: string;
      name?: string;
    }) => {
      const sub = sessions.createSubSession({
        parentSessionId: input.parentSessionId,
        parentMessageId: input.parentMessageId ?? null,
        name: input.name ?? "Sub-session",
      });
      sessions.appendMessages(sub.conversationId, [
        {
          role: "assistant",
          kind: "text",
          content: input.text,
          createdAt: new Date().toISOString(),
        },
      ]);
      pushNotification({
        kind: "session.message",
        title: input.name ?? "New message in a sub-session",
        body: input.text.slice(0, 200),
        link: `/chat/${sub.conversationId}`,
      });
      return {
        sessionId: sub.conversationId,
        messageId: sessions.lastMessageId(sub.conversationId),
      };
    };

    const onQueueError = (message: string, error: Error) => events.emit({ type: "error" as const, message, cause: error });
    const memoryQueue = new MemoryQueue({
      config,
      memory,
      sessions,
      runs: memoryRuns,
      postFailureToSubSession: postToSubSession,
      notify: pushNotification,
      usage,
      onQueueError,
    });

    const memoryConsolidate = new MemoryConsolidateQueue({
      config,
      memory,
      runs: memoryRuns,
      usage,
      notify: pushNotification,
      onQueueError,
    });
    void memoryConsolidate.schedule().catch((error) =>
      events.emit({ type: "error", message: `[memory.consolidate] failed to schedule cron: ${describe(error)}` }),
    );

    const skillPromote = new SkillPromoteQueue({
      config,
      skills,
      notify: pushNotification,
      onQueueError,
    });
    void skillPromote.schedule().catch((error) =>
      events.emit({ type: "error", message: `[skill.promote] failed to schedule cron: ${describe(error)}` }),
    );

    if (process.platform === "darwin" && !vecState.customSqliteApplied) {
      console.log(`[memory] sqlite-vec disabled: ${vecState.reason ?? "no extension-enabled SQLite"}`);
      pushNotification({
        kind: "info",
        title: "Memory: vector search disabled",
        body: "Run `brew install sqlite` to enable hybrid retrieval. Falling back to keyword-only search.",
        link: null,
      });
    }

    void Promise.all([embedder.init(), reranker.init()])
      .then(async () => {
        if (!memory.isHybridReady()) {
          const reason = embedder.initFailureReason() ?? "vec extension not loaded";
          console.log(`[memory] mode=fts5-only (${reason})`);
          return;
        }
        const rerankPart = memory.isRerankReady()
          ? `+rerank(${reranker.modelId})`
          : reranker.initFailureReason()
            ? ` (rerank disabled: ${reranker.initFailureReason()})`
            : "";
        console.log(
          `[memory] mode=hybrid model=${embedder.modelId} dim=${embedder.dim}${rerankPart}`,
        );
        const result = await memory.backfillEmbeddings();
        if (result.done > 0) {
          pushNotification({
            kind: "info",
            title: `Memory: indexed ${result.done} memor${result.done === 1 ? "y" : "ies"}`,
            body: null,
            link: null,
          });
        }
      })
      .catch((error) => {
        console.log(
          `[memory] embedder init failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    const runtime = new RuntimeImpl(
      config,
      events,
      live,
      sandbox,
      sessions,
      soul,
      soulStore,
      workspaces,
      settings,
      skills,
      memory,
      memoryRuns,
      memoryQueue,
      memoryConsolidate,
      skillPromote,
      notifications,
      usage,
      activeRuns,
    );
    runtimeRef = runtime;
    runtime.startSweep();
    registerSignalHandlers(runtime);
    return runtime;
  }

  assertReady(): void {
    if (this.resetting) throw new Error("Aithy is resetting. Try again in a moment.");
    assertStartupConfig(this.config);
  }

  async updateSettings(patch: SettingsPatch): Promise<StoredSettings> {
    const nextSettings = this.settings.save(patch);
    const nextConfig = await resolveEffectiveConfig(
      loadConfig(process.env, { traceEnabled: process.argv.includes("--trace") }),
      nextSettings,
    );
    if (runtimeSandboxChanged(this.config, nextConfig)) {
      this.sandbox = createSandboxProvider(nextConfig);
      await this.sessions.replaceSandboxProvider(this.sandbox);
    }
    this.sessions.setTtlMs(nextConfig.sessionTtlMs);
    this.sessions.setIdleParkMs(nextConfig.idleParkMs);
    this.sessions.setMaxLiveSandboxes(nextConfig.maxLiveSandboxes);
    if (globalMountsChanged(this.config, nextConfig)) {
      this.sessions.setGlobalMounts(nextConfig.globalMounts);
      this.sessions.refreshAllMounts();
    }
    this.config = nextConfig;
    return nextSettings;
  }

  updateSoul(fields: SoulFields): SoulProfile {
    this.soul = saveSoul(this.soulStore, fields);
    return this.soul;
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

    const stopped = this.activeRuns.stopAll();
    if (stopped > 0) {
      this.events.emit({ type: "error", message: `[shutdown] stopped ${stopped} active run(s)` });
    }

    await this.closeQueues();

    try {
      shutdownManager();
    } catch (error) {
      this.events.emit({
        type: "error",
        message: `[shutdown] bunqueue manager: ${describe(error)}`,
      });
    }

    try {
      await this.sessions.parkAll();
    } catch (error) {
      this.events.emit({
        type: "error",
        message: `[shutdown] parkAll failed: ${describe(error)}`,
      });
    }
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
      ["memoryQueue", this.memoryQueue.close.bind(this.memoryQueue)],
      ["memoryConsolidate", this.memoryConsolidate.close.bind(this.memoryConsolidate)],
      ["skillPromote", this.skillPromote.close.bind(this.skillPromote)],
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
    this.sessions.closeState();
    this.soulStore.close();
    this.settings.close();
    this.skills.close();
    this.memory.close();
    this.memoryRuns.close();
    this.notifications.close();
    this.usage.close();
  }
}
async function doResetAithyRuntimeSystem(): Promise<AithyRuntime> {
  const runtime = await getAithyRuntime();
  const impl = runtime as RuntimeImpl;
  await impl.prepareForFullReset();
  runtimePromise = undefined;
  await clearManagedProviderSecrets();
  await removeSqliteFiles(impl.config.stateDbPath);
  await removeSqliteFiles(path.join(path.dirname(impl.config.stateDbPath), "bunqueue.db"));
  return getAithyRuntime();
}
async function resolveEffectiveConfig(
  baseConfig: AppConfig,
  settings: StoredSettings,
): Promise<AppConfig> {
  const provider = settings.runtime.aiProvider?.trim() || baseConfig.aiProvider;
  const apiKey = baseConfig.aiApiKey ?? await readProviderApiKey(provider);
  const fastProvider = settings.runtime.fastAiProvider?.trim();
  const fastApiKey = fastProvider ? (fastProvider === provider ? apiKey : await readProviderApiKey(fastProvider)) : undefined;
  return applyRuntimeSettings(baseConfig, settings.runtime, apiKey, fastApiKey);
}
