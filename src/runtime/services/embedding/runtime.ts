import path from "node:path";
import { EmbedService } from "../../../memory/embed";
import { SqliteEpisodeStore } from "../../../episodes/episode-store";
import { SqliteMemoryStore } from "../../../memory/memory-store";
import { RerankerService } from "../../../memory/rerank";
import { assertVecExtensionReady, probeAndConfigureSqlite } from "../../../memory/vec-extension";
import type { SetupStatusInput } from "../../../setup/status";
import { EventBus } from "../../../events/bus";
import { LiveEventHub } from "../../../web/live-events";
import { SqliteSettingsStore } from "../../../settings/store";
import { assertSupportedBunVersion } from "../../bun-version";
import { loadBaseConfig, resolveEffectiveConfig } from "../../resolve-effective-config";
import type { RuntimeCommandRow } from "../../runtime-store";
import type { EmbeddingCommand } from "../../protocol/types";
import type { QueueServiceClient } from "../queue/client";

const BACKFILL_INTERVAL_MS = 15_000;

export class EmbeddingWorkerRuntime {
  private heartbeatTimer?: Timer;
  private backfillTimer?: Timer;
  private backfilling = false;
  private ready = false;
  private shutdownPromise?: Promise<void>;

  private constructor(
    private readonly config: Awaited<ReturnType<typeof resolveEffectiveConfig>>,
    private readonly settings: SqliteSettingsStore,
    private readonly queue: QueueServiceClient,
    private readonly memory: SqliteMemoryStore,
    private readonly episodes: SqliteEpisodeStore,
    private readonly embedder: EmbedService,
    private readonly reranker: RerankerService,
  ) {}

  static async create(queue: QueueServiceClient): Promise<EmbeddingWorkerRuntime> {
    assertSupportedBunVersion();
    const baseConfig = loadBaseConfig();
    const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
    const config = await resolveEffectiveConfig(baseConfig, settings.load());
    const events = new EventBus();
    const live = new LiveEventHub();
    events.subscribe((event) => live.publishBotEvent(event));
    live.subscribe((event) => {
      void queue.appendEvent(event);
    });
    const setupStatus = (status: SetupStatusInput) => {
      events.emit({ type: "setup.status", status });
      void queue.appendLog({
        role: "embedding-worker",
        level: status.tone === "danger" ? "error" : "info",
        source: "setup",
        message: status.label,
        detail: status,
      });
    };
    const stateRoot = path.dirname(config.stateDbPath);
    const cacheDir = path.join(stateRoot, "cache");
    const log = (message: string) => {
      console.log(`[embedding-worker] ${message}`);
      void queue.appendLog({ role: "embedding-worker", level: "info", source: "memory", message });
    };
    const vecState = probeAndConfigureSqlite();
    assertVecExtensionReady(vecState);
    const embedder = new EmbedService({ cacheDir, log, onStatus: setupStatus });
    const reranker = new RerankerService({ cacheDir, log, onStatus: setupStatus });
    const memory = new SqliteMemoryStore(config.stateDbPath, { embedder, reranker, log });
    const episodes = new SqliteEpisodeStore(config.stateDbPath, { embedder, reranker, log });
    return new EmbeddingWorkerRuntime(config, settings, queue, memory, episodes, embedder, reranker);
  }

  start(): void {
    this.heartbeat("starting", this.modelDetail());
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat(
        this.ready ? "ready" : "starting",
        this.modelDetail(),
      );
    }, 2_000);
    this.heartbeatTimer.unref();
    this.queue.onCommand((command) => this.handleCommand(command));
    this.backfillTimer = setInterval(() => void this.runBackfill("timer"), BACKFILL_INTERVAL_MS);
    this.backfillTimer.unref();
    void this.initialize();
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.doShutdown();
    return this.shutdownPromise;
  }

  private async initialize(): Promise<void> {
    try {
      await Promise.all([this.embedder.init(), this.reranker.init()]);
      if (!this.embedder.available()) throw new Error(this.embedder.initFailureReason() ?? "embedder unavailable");
      if (!this.reranker.available()) throw new Error(this.reranker.initFailureReason() ?? "reranker unavailable");
      this.ready = true;
      this.heartbeat("ready", this.modelDetail());
      await this.runBackfill("startup");
    } catch (error) {
      this.ready = false;
      this.appendLog({
        role: "embedding-worker",
        level: "error",
        source: "startup",
        message: error instanceof Error ? error.message : String(error),
      });
      this.heartbeat("failed", {
        ...this.modelDetail(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleCommand(command: RuntimeCommandRow): Promise<unknown> {
    this.appendLog({
      role: "embedding-worker",
      level: "debug",
      source: "command",
      message: `start ${command.kind}`,
      detail: { commandId: command.id },
    });
    try {
      const result = await this.runCommand(command.kind, command.payload);
      this.appendLog({
        role: "embedding-worker",
        level: "debug",
        source: "command",
        message: `complete ${command.kind}`,
        detail: { commandId: command.id },
      });
      return result;
    } catch (error) {
      this.appendLog({
        role: "embedding-worker",
        level: "error",
        source: "command",
        message: `failed ${command.kind}: ${error instanceof Error ? error.message : String(error)}`,
        detail: { commandId: command.id },
      });
      throw error;
    }
  }

  private async runCommand(kind: string, payload: unknown): Promise<EmbeddingCommand["result"]> {
    if (kind === "embedding.embedMany") {
      this.assertReady();
      const texts = stringArrayField(objectPayload(payload), "texts");
      const vectors = await this.embedder.embedMany(texts);
      return { vectors: vectors.map((vector) => Array.from(vector)) };
    }
    if (kind === "embedding.rerank") {
      this.assertReady();
      const value = objectPayload(payload);
      const scores = await this.reranker.rerank(stringField(value, "query"), stringArrayField(value, "docs"));
      return { scores };
    }
    if (kind === "embedding.backfill_now") {
      return this.runBackfill("command");
    }
    if (kind === "embedding.reload_settings") {
      this.appendLog({
        role: "embedding-worker",
        level: "info",
        source: "settings",
        message: "reload_settings received; embedding models are unchanged in this pass",
      });
      return undefined;
    }
    throw new Error(`Unknown embedding command: ${kind}`);
  }

  private assertReady(): void {
    if (this.ready && this.embedder.available() && this.reranker.available()) return;
    throw new Error("embedding-worker is not ready");
  }

  private async runBackfill(source: "startup" | "timer" | "command"): Promise<{ done: number; skipped: number }> {
    if (!this.ready || this.backfilling) return { done: 0, skipped: 0 };
    this.backfilling = true;
    try {
      const result = await this.memory.backfillEmbeddings();
      const episodeResult = await this.episodes.backfillEmbeddings();
      if (result.done > 0 || episodeResult.done > 0 || source !== "timer") {
        this.appendLog({
          role: "embedding-worker",
          level: "info",
          source: "backfill",
          message: `embedding backfill ${source}: memories ${result.done} indexed, episodes ${episodeResult.done} indexed`,
          detail: {
            memoryDone: result.done,
            memorySkipped: result.skipped,
            episodeDone: episodeResult.done,
            episodeSkipped: episodeResult.skipped,
          },
        });
      }
      return { done: result.done + episodeResult.done, skipped: result.skipped + episodeResult.skipped };
    } finally {
      this.backfilling = false;
    }
  }

  private async doShutdown(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.backfillTimer) clearInterval(this.backfillTimer);
    this.queue.beginShutdown();
    this.heartbeat("stopping");
    this.memory.close();
    this.episodes.close();
    this.settings.close();
    this.queue.close();
  }

  private appendLog(input: Parameters<QueueServiceClient["appendLog"]>[0]): void {
    void this.queue.appendLog(input);
  }

  private heartbeat(state: Parameters<QueueServiceClient["heartbeat"]>[1], detail?: unknown): void {
    void this.queue.heartbeat("embedding-worker", state, detail);
  }

  private modelDetail(): { embedderModel: string; rerankerModel: string } {
    return {
      embedderModel: this.embedder.modelId,
      rerankerModel: this.reranker.modelId,
    };
  }
}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") throw new Error("Invalid embedding command payload");
  return payload as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Invalid embedding command field: ${key}`);
  return field;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item) => typeof item === "string")) {
    throw new Error(`Invalid embedding command field: ${key}`);
  }
  return field;
}
