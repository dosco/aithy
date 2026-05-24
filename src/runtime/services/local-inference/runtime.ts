import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../../../config/env";
import { EventBus } from "../../../events/bus";
import { ensureRequiredLocalModels } from "../../../local-inference/download";
import { resolveHfHubCacheDir } from "../../../local-inference/hf-cache";
import { LocalLlamaEmbedder, LocalLlamaReranker } from "../../../local-inference/http-client";
import {
  LOCAL_CHAT_MODEL_ALIAS,
  LOCAL_EMBEDDING_DIM,
  LOCAL_EMBEDDING_MODEL_ALIAS,
  LOCAL_RERANKER_MODEL_ALIAS,
  selectedLocalAgentModelId,
} from "../../../local-inference/manifest";
import { renderLlamaModelsIni } from "../../../local-inference/models-ini";
import {
  LLAMA_ROUTER_MARKER_FILE,
  loadAndWarmRouter,
  removeLlamaRouterMarker,
  startLlamaRouter,
  waitForRouterReady,
  type LlamaRouterProcess,
} from "../../../local-inference/router";
import { localChatRequired, localInferenceRequired } from "../../../local-inference/status";
import { assertVecExtensionReady, probeAndConfigureSqlite } from "../../../memory/vec-extension";
import { SqliteEpisodeStore } from "../../../episodes/episode-store";
import { SqliteMemoryStore } from "../../../memory/memory-store";
import { SqliteSkillsStore } from "../../../skills/skills-store";
import { activeStatus, failedStatus, readyStatus, type SetupStatusInput } from "../../../setup/status";
import { SqliteSettingsStore } from "../../../settings/store";
import { LiveEventHub } from "../../../web/live-events";
import { assertSupportedBunVersion } from "../../bun-version";
import { loadBaseConfig, resolveEffectiveConfig } from "../../resolve-effective-config";
import type { RuntimeCommandRow } from "../../runtime-store";
import type { EmbeddingCommand, LocalInferenceCommand, RuntimeServiceState } from "../../protocol/types";
import type { QueueServiceClient } from "../queue/client";
import { resolveLlamaServerBinary, type LlamaServerBinary } from "../../../local-inference/binary";
import { emptyIndexCounts, type EmbeddingHealthStats, type TargetIndexCounts } from "../../../retrieval/indexing";
import { captureLines, delay, streamOrNull } from "./log-streams";
import { LocalInferenceRecovery } from "./recovery";
import {
  localInferenceLoadSettingsKey,
  objectPayload,
  optionalStringArray,
  requiredPath,
  routerPid,
  stringArrayField,
  stringField,
} from "./runtime-helpers";

const BACKFILL_INTERVAL_MS = 15_000;
const SHUTDOWN_GRACE_MS = 10_000;

type LocalCommandResult = (LocalInferenceCommand | EmbeddingCommand)["result"];

export class LocalInferenceWorkerRuntime {
  private heartbeatTimer?: Timer;
  private backfillTimer?: Timer;
  private shutdownPromise?: Promise<void>;
  private config!: AppConfig;
  private ready = false;
  private chatReady = false;
  private backfilling = false;
  private error: string | null = null;
  private modelId: string | null = null;
  private modelPaths: Record<string, string> = {};
  private baseUrl: string | null = null;
  private healthUrl: string | null = null;
  private modelsIniPath: string | null = null;
  private routerMarkerPath: string | null = null;
  private binary: LlamaServerBinary | null = null;
  private loadSettingsKey: string | null = null;
  private configurePromise: Promise<void> = Promise.resolve();
  private router: LlamaRouterProcess | null = null;
  private readonly recovery = new LocalInferenceRecovery();
  private readonly embedder = new LocalLlamaEmbedder(() => this.baseUrl);
  private readonly reranker = new LocalLlamaReranker(() => this.baseUrl);
  private memory!: SqliteMemoryStore;
  private episodes!: SqliteEpisodeStore;
  private skills!: SqliteSkillsStore;
  private lastTargetedIndexAt: string | null = null;
  private lastBackfillAt: string | null = null;
  private lastIndexError: string | null = null;
  private lastRouterExitCode: number | null = null;
  private lastRouterExitAt: string | null = null;

  private constructor(
    private readonly settings: SqliteSettingsStore,
    private readonly queue: QueueServiceClient,
    private readonly onStatus: (status: SetupStatusInput) => void,
  ) {}

  static async create(queue: QueueServiceClient): Promise<LocalInferenceWorkerRuntime> {
    assertSupportedBunVersion();
    const baseConfig = loadBaseConfig();
    const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
    const events = new EventBus();
    const live = new LiveEventHub();
    events.subscribe((event) => live.publishBotEvent(event));
    live.subscribe((event) => {
      void queue.appendEvent(event);
    });
    const onStatus = (status: SetupStatusInput) => {
      events.emit({ type: "setup.status", status });
      void queue.appendLog({
        role: "local-inference-worker",
        level: status.tone === "danger" ? "error" : "info",
        source: "setup",
        message: status.label,
        detail: status,
      });
    };
    const runtime = new LocalInferenceWorkerRuntime(settings, queue, onStatus);
    runtime.config = await resolveEffectiveConfig(baseConfig, settings.load());
    const vecState = probeAndConfigureSqlite();
    assertVecExtensionReady(vecState);
    const log = (message: string) => {
      console.log(`[local-inference-worker] ${message}`);
      void queue.appendLog({ role: "local-inference-worker", level: "info", source: "memory", message });
    };
    runtime.memory = new SqliteMemoryStore(runtime.config.stateDbPath, {
      embedder: runtime.embedder,
      reranker: runtime.reranker,
      log,
    });
    runtime.episodes = new SqliteEpisodeStore(runtime.config.stateDbPath, {
      embedder: runtime.embedder,
      reranker: runtime.reranker,
      log,
    });
    runtime.skills = new SqliteSkillsStore(runtime.config.stateDbPath, {
      embedder: runtime.embedder,
      reranker: runtime.reranker,
      log,
    });
    return runtime;
  }

  start(): void {
    this.heartbeat("starting");
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat(this.ready ? "ready" : this.error ? "degraded" : "starting");
    }, 2_000);
    this.heartbeatTimer.unref();
    this.backfillTimer = setInterval(() => void this.runBackfill("timer"), BACKFILL_INTERVAL_MS);
    this.backfillTimer.unref();
    this.queue.onCommand((command) => this.handleCommand(command));
    void this.queueConfigure();
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.doShutdown();
    return this.shutdownPromise;
  }

  private async configure(): Promise<void> {
    try {
      this.config = await resolveEffectiveConfig(loadBaseConfig(), this.settings.load());
      if (!localInferenceRequired(this.config)) {
        await this.unload();
        this.modelId = null;
        this.ready = true;
        this.chatReady = false;
        this.error = null;
        this.recovery.reset();
        this.heartbeat("ready");
        return;
      }
      this.ready = false;
      this.chatReady = false;
      this.error = null;
      const chatRequired = localChatRequired(this.config);
      const nextModelId = selectedLocalAgentModelId(this.config.localAgentModel ?? this.config.aiModel);
      const nextLoadSettingsKey = localInferenceLoadSettingsKey(this.config.localInference, chatRequired ? nextModelId : null);
      if (this.canReuseRouter(chatRequired ? nextModelId : null, nextLoadSettingsKey)) {
        this.ready = true;
        this.chatReady = chatRequired;
        this.error = null;
        this.recovery.reset();
        this.heartbeat("ready");
        return;
      }
      await this.unload();
      this.modelId = chatRequired ? nextModelId : null;
      this.onStatus(activeStatus("local.router", "preparing local inference models"));
      const modelPaths = await ensureRequiredLocalModels({
        includeChat: chatRequired,
        chatModelId: nextModelId,
        onStatus: this.onStatus,
      });
      this.modelPaths = Object.fromEntries(modelPaths);
      const stateRoot = path.dirname(this.config.stateDbPath);
      const localDir = path.join(stateRoot, "local-inference");
      await mkdir(localDir, { recursive: true });
      this.binary = await resolveLlamaServerBinary({
        stateRoot,
        settingsPath: this.config.localInference.llamaServerPath,
      });
      this.modelsIniPath = path.join(localDir, "models.ini");
      this.routerMarkerPath = path.join(localDir, LLAMA_ROUTER_MARKER_FILE);
      await writeFile(this.modelsIniPath, renderLlamaModelsIni(this.config.localInference, {
        chat: modelPaths.get("chat"),
        embedding: requiredPath(modelPaths, "embedding"),
        reranker: requiredPath(modelPaths, "reranker"),
      }));
      this.onStatus(activeStatus("local.router", "starting llama.cpp router"));
      this.router = await startLlamaRouter({
        binaryPath: this.binary.path,
        modelsIniPath: this.modelsIniPath,
        settings: this.config.localInference,
        cwd: localDir,
        markerPath: this.routerMarkerPath,
      });
      this.baseUrl = this.router.baseUrl;
      this.healthUrl = `${this.baseUrl}/health`;
      void captureLines(this.queue, streamOrNull(this.router.proc.stdout), "stdout");
      void captureLines(this.queue, streamOrNull(this.router.proc.stderr), "stderr");
      void this.router.proc.exited.then((code) => this.handleRouterExit(code));
      await waitForRouterReady(this.baseUrl);
      await loadAndWarmRouter({
        baseUrl: this.baseUrl,
        includeChat: chatRequired,
        onStep: (label) => this.onStatus(activeStatus("local.router", label)),
      });
      this.loadSettingsKey = nextLoadSettingsKey;
      this.ready = true;
      this.chatReady = chatRequired;
      this.error = null;
      this.recovery.reset();
      this.heartbeat("ready");
      this.onStatus(readyStatus("local.router", "local inference ready"));
      await this.runBackfill("startup");
    } catch (error) {
      await this.unload();
      this.ready = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.onStatus(failedStatus("local.router", `local inference failed: ${this.error}`));
      this.scheduleRecovery(this.error);
    }
  }

  private canReuseRouter(modelId: string | null, settingsKey: string): boolean {
    return this.modelId === modelId
      && Boolean(this.router)
      && Boolean(this.baseUrl)
      && this.loadSettingsKey === settingsKey;
  }

  private queueConfigure(): Promise<void> {
    const run = this.configurePromise.then(
      () => this.configure(),
      () => this.configure(),
    );
    this.configurePromise = run.catch(() => undefined);
    return run;
  }

  private async unload(): Promise<void> {
    const router = this.router;
    const markerPath = this.routerMarkerPath;
    const pid = router ? routerPid(router) : undefined;
    this.router = null;
    this.baseUrl = null;
    this.healthUrl = null;
    this.loadSettingsKey = null;
    if (!router) return;
    router.proc.kill("SIGTERM");
    const exited = router.proc.exited.catch(() => undefined);
    const graceful = await Promise.race([
      exited.then(() => true),
      delay(SHUTDOWN_GRACE_MS).then(() => false),
    ]);
    if (!graceful) {
      router.proc.kill("SIGKILL");
      await exited;
    }
    if (markerPath) await removeLlamaRouterMarker(markerPath, pid);
  }

  private async handleCommand(command: RuntimeCommandRow): Promise<LocalCommandResult> {
    if (command.kind === "local-inference.reload_settings" || command.kind === "embedding.reload_settings") {
      const run = this.recovery.runNow(() => this.queueConfigure());
      if (run) await run;
      return undefined;
    }
    if (command.kind === "local-inference.status") return this.detail();
    if (command.kind === "embedding.embedMany") {
      this.assertReady();
      const vectors = await this.embedder.embedMany(stringArrayField(objectPayload(command.payload), "texts"));
      return { vectors: vectors.map((vector) => Array.from(vector)) };
    }
    if (command.kind === "embedding.embedQuery") {
      this.assertReady();
      const vector = await this.embedder.embedQuery(stringField(objectPayload(command.payload), "text"));
      return { vector: Array.from(vector) };
    }
    if (command.kind === "embedding.rerank") {
      this.assertReady();
      const value = objectPayload(command.payload);
      const scores = await this.reranker.rerank(stringField(value, "query"), stringArrayField(value, "docs"));
      return { scores };
    }
    if (command.kind === "embedding.backfill_now") return this.runBackfill("command");
    if (command.kind === "embedding.indexTargets") return this.indexTargets(objectPayload(command.payload));
    throw new Error(`Unknown local inference command: ${command.kind}`);
  }

  private assertReady(): void {
    if (this.ready && this.baseUrl) return;
    throw new Error("local inference router is not ready");
  }

  private async runBackfill(source: "startup" | "timer" | "command"): Promise<{ done: number; skipped: number }> {
    if (!this.ready || this.backfilling) return { done: 0, skipped: 0 };
    this.backfilling = true;
    try {
      const result = await this.memory.backfillEmbeddings();
      const episodeResult = await this.episodes.backfillEmbeddings();
      const skillResult = await this.skills.backfillEmbeddings();
      const done = result.done + episodeResult.done + skillResult.done;
      const skipped = result.skipped + episodeResult.skipped + skillResult.skipped;
      this.lastBackfillAt = new Date().toISOString();
      this.lastIndexError = null;
      if (done > 0 || source !== "timer") {
        void this.queue.appendLog({
          role: "local-inference-worker",
          level: "info",
          source: "backfill",
          message: `embedding backfill ${source}: memories ${result.done}, episodes ${episodeResult.done}, skills ${skillResult.done}`,
          detail: { memoryDone: result.done, episodeDone: episodeResult.done, skillDone: skillResult.done, skipped },
        });
      }
      return { done, skipped };
    } catch (error) {
      this.lastIndexError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.backfilling = false;
    }
  }

  private async indexTargets(payload: Record<string, unknown>): Promise<{ memories: TargetIndexCounts; episodes: TargetIndexCounts; skills: TargetIndexCounts }> {
    this.assertReady();
    const memories = optionalStringArray(payload, "memories");
    const episodes = optionalStringArray(payload, "episodes");
    const skills = optionalStringArray(payload, "skills");
    try {
      const [memoryResult, episodeResult, skillResult] = await Promise.all([
        memories.length ? this.memory.indexEmbeddings(memories) : emptyIndexCounts(),
        episodes.length ? this.episodes.indexEmbeddings(episodes) : emptyIndexCounts(),
        skills.length ? this.skills.indexEmbeddings(skills) : emptyIndexCounts(),
      ]);
      this.lastTargetedIndexAt = new Date().toISOString();
      this.lastIndexError = null;
      void this.queue.appendLog({
        role: "local-inference-worker",
        level: "info",
        source: "retrieval",
        message: "targeted embedding index",
        detail: { memories: memoryResult, episodes: episodeResult, skills: skillResult },
      });
      return { memories: memoryResult, episodes: episodeResult, skills: skillResult };
    } catch (error) {
      this.lastIndexError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private handleRouterExit(code: number): void {
    if (!this.router) return;
    const markerPath = this.routerMarkerPath;
    const pid = routerPid(this.router);
    this.ready = false;
    this.chatReady = false;
    this.error = `llama-server exited with code ${code}`;
    this.lastRouterExitCode = code;
    this.lastRouterExitAt = new Date().toISOString();
    this.router = null;
    this.baseUrl = null;
    this.healthUrl = null;
    if (markerPath) void removeLlamaRouterMarker(markerPath, pid);
    this.scheduleRecovery(this.error);
  }

  private async doShutdown(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.backfillTimer) clearInterval(this.backfillTimer);
    this.recovery.shutdown();
    this.queue.beginShutdown();
    this.heartbeat("stopping");
    await this.unload();
    this.memory.close();
    this.episodes.close();
    this.skills.close();
    this.settings.close();
    this.queue.close();
  }

  private heartbeat(state: RuntimeServiceState, extra: Record<string, unknown> = {}): void {
    void this.queue.heartbeat("local-inference-worker", state, this.detail(extra));
  }

  private scheduleRecovery(error: string): void {
    const retry = this.recovery.schedule(() => void this.queueConfigure());
    const retryText = retry ? `; retrying in ${formatDelay(retry.restartInMs)}` : "";
    void this.queue.appendLog({
      role: "local-inference-worker",
      level: "warn",
      source: "recovery",
      message: `local inference degraded: ${error}${retryText}`,
      detail: retry ?? undefined,
    });
    this.heartbeat("degraded", retry ? { ...retry } : {});
  }

  private detail(extra: Record<string, unknown> = {}) {
    return {
      required: localChatRequired(this.config),
      routerRequired: localInferenceRequired(this.config),
      chatRequired: localChatRequired(this.config),
      chatReady: this.chatReady,
      ready: this.ready,
      modelId: this.modelId,
      modelPath: this.modelPaths.chat ?? null,
      modelPaths: this.modelPaths,
      chatAlias: LOCAL_CHAT_MODEL_ALIAS,
      embeddingAlias: LOCAL_EMBEDDING_MODEL_ALIAS,
      rerankerAlias: LOCAL_RERANKER_MODEL_ALIAS,
      embeddingDim: LOCAL_EMBEDDING_DIM,
      baseUrl: this.baseUrl,
      healthUrl: this.healthUrl,
      cacheDir: resolveHfHubCacheDir(),
      binaryPath: this.binary?.path ?? null,
      binarySource: this.binary?.source ?? null,
      binaryVersion: this.binary?.version ?? null,
      modelsIniPath: this.modelsIniPath,
      error: this.error,
      lastRouterExitCode: this.lastRouterExitCode,
      lastRouterExitAt: this.lastRouterExitAt,
      embeddingHealth: this.embeddingHealth(),
      settings: this.config.localInference,
      ...this.recovery.pendingDetail(),
      ...extra,
    };
  }

  private embeddingHealth(): {
    memories: EmbeddingHealthStats;
    episodes: EmbeddingHealthStats;
    skills: EmbeddingHealthStats;
    lastTargetedIndexAt: string | null;
    lastBackfillAt: string | null;
    lastIndexError: string | null;
    rerankerReady: boolean;
  } {
    return {
      memories: this.memory.embeddingStats(),
      episodes: this.episodes.embeddingStats(),
      skills: this.skills.embeddingStats(),
      lastTargetedIndexAt: this.lastTargetedIndexAt,
      lastBackfillAt: this.lastBackfillAt,
      lastIndexError: this.lastIndexError,
      rerankerReady: this.reranker.available(),
    };
  }
}

function formatDelay(ms: number): string {
  if (ms >= 1_000) return `${Math.ceil(ms / 1_000)}s`;
  return `${ms}ms`;
}
