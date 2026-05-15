import { mkdir } from "node:fs/promises";
import { shutdownManager } from "bunqueue/client";
import { ActiveRunRegistry } from "../../../agent/active-runs";
import { SqliteArtifactStore } from "../../../artifacts/artifact-store";
import { AgentDispatcher, type UserChatJobData, type UserChatJobResult } from "../../../agent/dispatcher";
import { EventBus } from "../../../events/bus";
import { MemoryConsolidateQueue } from "../../../memory/consolidate-queue";
import { MemoryExpiryQueue } from "../../../memory/expiry-queue";
import { SqliteMemoryRunsStore } from "../../../memory/memory-runs";
import { MemoryQueue } from "../../../memory/memory-queue";
import { SqliteMemoryStore } from "../../../memory/memory-store";
import { SqliteNotificationStore } from "../../../notifications/notification-store";
import type { NotificationCreate, NotificationEntry } from "../../../notifications/types";
import { CapabilityBroker } from "../../../security/capability-broker";
import { SqliteTaskStore } from "../../../tasks/task-store";
import type { TaskRecord } from "../../../tasks/types";
import { SessionManager } from "../../../session/session-manager";
import { globalMountsChanged, runtimeSandboxChanged } from "../../../settings/resolve";
import { SqliteSettingsStore } from "../../../settings/store";
import { seedSkillsIfEmpty } from "../../../skills/seed";
import { SqliteSkillCandidateStore } from "../../../skills/candidate-store";
import { SkillCandidateQueue } from "../../../skills/candidate-queue";
import { SqliteSkillPromotionStore } from "../../../skills/promote-store";
import { SqliteSkillsStore } from "../../../skills/skills-store";
import { loadOrSeedSoul } from "../../../soul/service";
import { SqliteSoulStore } from "../../../soul/sqlite-soul-store";
import type { SoulProfile } from "../../../soul/types";
import type { SetupStatusInput } from "../../../setup/status";
import { SqliteUsageStore } from "../../../usage/usage-store";
import { LiveEventHub } from "../../../web/live-events";
import { assertSupportedBunVersion } from "../../bun-version";
import { loadBaseConfig, resolveEffectiveConfig } from "../../resolve-effective-config";
import { RuntimeStore, type RuntimeCommandRow } from "../../runtime-store";
import { processUserChatJob } from "../../process-user-chat-job";
import { postToSubSessionAndFlush } from "../../post-sub-session";
import { publishUserChatFailure, publishUserChatReply } from "../../user-chat-live-events";
import { RemoteEmbedder, RemoteReranker } from "../embedding/client";
import { SandboxCommandClient } from "../sandbox/client";
import { QueueServiceClient } from "../queue/client";
import { RemoteSessionStateStore } from "../queue/session-state-client";

export class AgentWorkerRuntime {
  private heartbeatTimer?: Timer;
  private shutdownPromise?: Promise<void>;
  private lastQueueKey = "";

  private constructor(
    public config: Awaited<ReturnType<typeof resolveEffectiveConfig>>,
    private readonly settings: SqliteSettingsStore,
    private readonly queue: QueueServiceClient,
    public readonly events: EventBus,
    public readonly live: LiveEventHub,
    public sandbox: SandboxCommandClient,
    public readonly sessions: SessionManager,
    public readonly soul: SoulProfile,
    public readonly memory: SqliteMemoryStore,
    public readonly artifacts: SqliteArtifactStore,
    public readonly usage: SqliteUsageStore,
    public readonly activeRuns: ActiveRunRegistry,
    public readonly skills: SqliteSkillsStore,
    public readonly runtimeStore: RuntimeStore,
    public readonly tasks: SqliteTaskStore,
    public readonly capabilities: CapabilityBroker,
    public readonly notifications: SqliteNotificationStore,
    private readonly dispatcher: AgentDispatcher,
    private readonly sessionState: RemoteSessionStateStore,
    public readonly memoryQueue: MemoryQueue,
    private readonly memoryConsolidate: MemoryConsolidateQueue,
    private readonly memoryExpiry: MemoryExpiryQueue,
    public readonly skillCandidates: SqliteSkillCandidateStore,
    public readonly skillCandidateQueue: SkillCandidateQueue,
    public readonly skillPromotions: SqliteSkillPromotionStore,
    private readonly stores: { close(): void }[],
  ) {}

  static async create(queue: QueueServiceClient): Promise<AgentWorkerRuntime> {
    assertSupportedBunVersion();
    const baseConfig = loadBaseConfig();
    const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
    const config = await resolveEffectiveConfig(baseConfig, settings.load());
    await mkdir(config.workspaceRoot, { recursive: true });
    await mkdir(config.outboxRoot, { recursive: true });

    await queue.services();
    const runtimeStore = new RuntimeStore(config.stateDbPath);
    const tasks = new SqliteTaskStore(config.stateDbPath);
    const capabilities = new CapabilityBroker(runtimeStore);
    capabilities.ensureDefaultLocalGrants();

    const events = new EventBus();
    const live = new LiveEventHub();
    events.subscribe((event) => live.publishBotEvent(event));
    live.subscribe((event) => {
      void queue.appendEvent(event);
    });
    const setupStatus = (status: SetupStatusInput) => events.emit({ type: "setup.status", status });

    const logMemory = (message: string) => {
      console.log(`[agent-worker] ${message}`);
      void queue.appendLog({ role: "agent-worker", level: "info", source: "memory", message });
    };
    const embedder = new RemoteEmbedder(queue);
    const reranker = new RemoteReranker(queue);
    const memory = new SqliteMemoryStore(config.stateDbPath, {
      embedder,
      reranker,
      inlineEmbeds: false,
      log: logMemory,
    });
    const memoryRuns = new SqliteMemoryRunsStore(config.stateDbPath);
    const notifications = new SqliteNotificationStore(config.stateDbPath);
    const artifacts = new SqliteArtifactStore(config.stateDbPath, config.workspaceRoot, config.outboxRoot);
    const usage = new SqliteUsageStore(config.stateDbPath);
    const skills = new SqliteSkillsStore(config.stateDbPath);
    seedSkillsIfEmpty(skills);
    const skillPromotions = new SqliteSkillPromotionStore(config.stateDbPath);
    const skillCandidates = new SqliteSkillCandidateStore(config.stateDbPath);
    const soulStore = new SqliteSoulStore(config.stateDbPath);
    const soul = loadOrSeedSoul(soulStore);

    const sandbox = new SandboxCommandClient(queue);
    const activeRuns = new ActiveRunRegistry();
    const sessionState = new RemoteSessionStateStore(queue);
    let runtimeRef: AgentWorkerRuntime | null = null;
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
        if (runtimeRef) runtimeRef.config = { ...runtimeRef.config, globalMounts: mounts };
      },
    });

    const notify = (input: NotificationCreate): NotificationEntry => {
      const entry = notifications.push(input);
      live.publish({
        type: "notification",
        id: crypto.randomUUID(),
        createdAt: entry.createdAt,
        notification: { ...entry },
      });
      return entry;
    };
    const postSub = (input: Parameters<typeof postToSubSessionAndFlush>[3]) =>
      postToSubSessionAndFlush(sessions, live, notify, input, () => sessionState.flush());
    const onQueueError = (message: string, error: Error) =>
      events.emit({ type: "error", message, cause: error });
    const publishTask = (task: TaskRecord) => events.emit({ type: "task.status", task });

    const memoryQueue = new MemoryQueue({
      config,
      memory,
      sessions,
      runs: memoryRuns,
      tasks,
      onTaskStatus: publishTask,
      postFailureToSubSession: postSub,
      notify,
      usage,
      onQueueError,
    });
    const memoryConsolidate = new MemoryConsolidateQueue({ config, memory, runs: memoryRuns, tasks, onTaskStatus: publishTask, usage, notify, onQueueError });
    const memoryExpiry = new MemoryExpiryQueue({ config, memory, tasks, onTaskStatus: publishTask, notify, onQueueError });
    const skillCandidateQueue = new SkillCandidateQueue({
      config,
      candidates: skillCandidates,
      tasks,
      onTaskStatus: publishTask,
      postToSubSession: postSub,
      notify,
      onQueueError,
    });
    await Promise.all([memoryConsolidate.schedule(), memoryExpiry.schedule()]);

    const dispatcher = new AgentDispatcher({
      stateDbPath: config.stateDbPath,
      parallelAgents: config.parallelAgents,
      ensureBotSandbox: () => sessions.ensureBotSandbox(),
      onStatus: setupStatus,
      onError: onQueueError,
      onStarted: (data, jobId) => {
        if (!runtimeRef || !data.taskId) return;
        const task = runtimeRef.tasks.update(data.taskId, {
          status: "running",
          queueJobId: jobId,
          reason: "Agent is working",
        });
        if (task) runtimeRef.events.emit({ type: "task.status", task });
      },
      onCompleted: (_data, result) => {
        if (runtimeRef) {
          if (_data.taskId) {
            const status = result.text === "[stopped]" ? "cancelled" : result.text.startsWith("Error:") ? "failed" : "completed";
            const task = runtimeRef.tasks.update(_data.taskId, {
              status,
              reason: status === "completed" ? "Done" : status === "cancelled" ? "Stopped by user" : "Agent returned an error",
              resultSummary: status === "completed" ? result.text.slice(0, 500) : null,
              errorSummary: status === "failed" ? result.text.slice(0, 500) : null,
            });
            if (task) runtimeRef.events.emit({ type: "task.status", task });
          }
          publishUserChatReply(runtimeRef, result);
          runtimeRef.publishQueueStatus();
        }
      },
      onFailed: (data, error) => {
        if (runtimeRef) {
          if (data.taskId) {
            const task = runtimeRef.tasks.update(data.taskId, {
              status: "failed",
              reason: "Agent run failed",
              errorSummary: error.message,
            });
            if (task) {
              runtimeRef.events.emit({ type: "task.status", task });
              runtimeRef.notify({
                kind: "task.failed",
                title: task.title,
                body: error.message,
                link: task.relatedSessionId ? `/chat/${task.relatedSessionId}` : null,
              });
            }
          }
          publishUserChatFailure(runtimeRef, data, error);
          void runtimeRef.flushSessionState();
          runtimeRef.publishQueueStatus();
        }
      },
      process: async (data: UserChatJobData): Promise<UserChatJobResult> => {
        if (!runtimeRef) throw new Error("agent worker runtime not initialized");
        return processUserChatJob(runtimeRef, data);
      },
    });

    const runtime = new AgentWorkerRuntime(
      config,
      settings,
      queue,
      events,
      live,
      sandbox,
      sessions,
      soul,
      memory,
      artifacts,
      usage,
      activeRuns,
      skills,
      runtimeStore,
      tasks,
      capabilities,
      notifications,
      dispatcher,
      sessionState,
      memoryQueue,
      memoryConsolidate,
      memoryExpiry,
      skillCandidates,
      skillCandidateQueue,
      skillPromotions,
      [settings, skills, skillCandidates, skillPromotions, memory, memoryRuns, artifacts, notifications, usage, soulStore, runtimeStore, tasks],
    );
    runtimeRef = runtime;
    return runtime;
  }

  notify(input: NotificationCreate): NotificationEntry {
    const entry = this.notifications.push(input);
    this.live.publish({
      type: "notification",
      id: crypto.randomUUID(),
      createdAt: entry.createdAt,
      notification: { ...entry },
    });
    return entry;
  }

  start(): void {
    this.dispatcher.resume();
    this.heartbeat("ready", { parallelAgents: this.config.parallelAgents });
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat("ready", { parallelAgents: this.config.parallelAgents });
      this.publishQueueStatus();
    }, 2_000);
    this.heartbeatTimer.unref();
    this.queue.onCommand((command) => this.handleCommand(command));
  }

  isShuttingDown(): boolean {
    return Boolean(this.shutdownPromise);
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.doShutdown();
    return this.shutdownPromise;
  }

  private async handleCommand(command: RuntimeCommandRow): Promise<unknown> {
    if (command.kind === "enqueue_user_chat") {
      const payload = userChatPayload(command.payload);
      await this.sessionState.preloadSession(payload.conversationId);
      const job = await this.dispatcher.enqueueUserChat(payload);
      if (payload.taskId) {
        const task = this.tasks.update(payload.taskId, {
          runtimeCommandId: command.id,
          queueJobId: job.jobId,
          reason: "Queued for agent",
        });
        if (task) this.events.emit({ type: "task.status", task });
      }
      this.publishQueueStatus();
      return job;
    }
    if (command.kind === "stop_conversation") {
      const conversationId = payloadString(command.payload, "conversationId");
      if (!conversationId) return { cancelled: 0 };
      this.activeRuns.stop(conversationId);
      const cancelled = await this.dispatcher.cancelByConversation(conversationId, "Stopped by user");
      this.publishQueueStatus();
      return { cancelled };
    }
    if (command.kind === "stop_all") {
      this.activeRuns.stopAll();
      const cancelled = await this.dispatcher.cancelAll("Stopped by user");
      this.publishQueueStatus();
      return { cancelled };
    }
    if (command.kind === "reload_settings") {
      await this.reloadSettings();
      return { reloaded: true };
    }
    throw new Error(`Unknown agent command: ${command.kind}`);
  }

  private publishQueueStatus(): void {
    const status = this.dispatcher.queueStatus();
    const key = JSON.stringify({
      state: status.state,
      depth: status.depth,
      activeCount: status.activeCount,
      blockedReason: status.blockedReason,
    });
    if (key === this.lastQueueKey) return;
    this.lastQueueKey = key;
    void this.queue.appendQueueStatus(status);
  }

  private async reloadSettings(): Promise<void> {
    const next = await resolveEffectiveConfig(loadBaseConfig(), this.settings.load());
    this.sessions.setTtlMs(next.sessionTtlMs);
    this.sessions.setIdleParkMs(next.idleParkMs);
    if (this.config.parallelAgents !== next.parallelAgents) this.dispatcher.setConcurrency(next.parallelAgents);
    if (runtimeSandboxChanged(this.config, next)) {
      await this.sessions.replaceSandboxProvider(this.sandbox);
      await this.queue.submitCommand("sandbox-worker", "sandbox.reload_settings");
    }
    if (globalMountsChanged(this.config, next)) {
      this.sessions.setGlobalMounts(next.globalMounts);
      this.sessions.refreshAllMounts();
    }
    await this.queue.submitCommand("embedding-worker", "embedding.reload_settings");
    this.config = next;
    this.publishQueueStatus();
  }

  private async doShutdown(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.queue.beginShutdown();
    this.heartbeat("stopping");
    await Promise.allSettled([
      this.dispatcher.close(),
      this.memoryQueue.close(),
      this.memoryConsolidate.close(),
      this.memoryExpiry.close(),
      this.skillCandidateQueue.close(),
      this.sessions.parkAll(),
      this.sessionState.flush(),
    ]);
    try {
      shutdownManager();
    } catch {}
    for (const store of this.stores) {
      try {
        store.close();
      } catch {}
    }
    this.queue.close();
  }

  private appendLog(input: Parameters<RuntimeStore["appendLog"]>[0]): void {
    void this.queue.appendLog(input);
  }

  private heartbeat(state: Parameters<QueueServiceClient["heartbeat"]>[1], detail?: unknown): void {
    void this.queue.heartbeat("agent-worker", state, detail);
  }

  flushSessionState(): Promise<void> {
    return this.sessionState.flush();
  }
}

function userChatPayload(payload: unknown): UserChatJobData {
  if (!payload || typeof payload !== "object") throw new Error("Invalid user chat command payload");
  const value = payload as Record<string, unknown>;
  const conversationId = value.conversationId;
  const text = value.text;
  const createdAt = value.createdAt;
  const skillIds = value.skillIds;
  if (
    typeof conversationId !== "string"
    || typeof text !== "string"
    || typeof createdAt !== "string"
    || !Array.isArray(skillIds)
    || !skillIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Invalid user chat command payload");
  }
  const taskId = typeof value.taskId === "string" ? value.taskId : undefined;
  return { conversationId, text, createdAt, skillIds, ...(taskId ? { taskId } : {}) };
}

function payloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
