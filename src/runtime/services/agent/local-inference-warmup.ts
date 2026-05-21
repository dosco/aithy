import type { AgentWorkerContext } from "../../../agent/dispatcher";
import type { AppConfig } from "../../../config/env";
import type { EventBus } from "../../../events/bus";
import { LOCAL_CHAT_MODEL_ALIAS, selectedLocalAgentModelId } from "../../../local-inference/manifest";
import { localChatRequired, localInferenceDetail } from "../../../local-inference/status";
import { warmLocalAgentCache } from "../../../local-inference/warmup";
import { activeStatus, failedStatus, readyStatus } from "../../../setup/status";
import type { RuntimeStore } from "../../runtime-store";

type WarmLocalAgentCache = typeof warmLocalAgentCache;

export class LocalInferenceWarmupGate {
  private readyKey: string | null = null;
  private pending: { key: string; promise: Promise<void> } | null = null;

  constructor(private readonly warm: WarmLocalAgentCache = warmLocalAgentCache) {}

  async ensure(input: {
    config: AppConfig;
    context: AgentWorkerContext;
    events: EventBus;
    runtimeStore: RuntimeStore;
  }): Promise<void> {
    if (!localChatRequired(input.config)) return;
    const service = input.runtimeStore.service("local-inference-worker");
    const detail = localInferenceDetail(service);
    const modelId = selectedLocalAgentModelId(input.config.localAgentModel ?? input.config.aiModel);
    if (service?.state !== "ready" || !detail?.ready || !detail.chatReady || !detail.baseUrl || detail.modelId !== modelId) {
      return;
    }

    const chatAlias = detail.chatAlias ?? LOCAL_CHAT_MODEL_ALIAS;
    const key = `${detail.baseUrl}|${modelId}|${chatAlias}`;
    if (this.readyKey === key) return;
    if (this.pending?.key === key) {
      await this.pending.promise;
      return;
    }
    if (input.context.agentWorkerId !== 1) return;
    this.pending = {
      key,
      promise: this.run(input.events, key, detail.baseUrl, chatAlias, input.context.agentWorkerId),
    };
    await this.pending.promise;
  }

  private async run(
    events: EventBus,
    key: string,
    baseUrl: string,
    modelId: string,
    agentWorkerId: number,
  ): Promise<void> {
    events.emit({
      type: "setup.status",
      status: activeStatus("local.agent.warmup", `agent ${agentWorkerId} warming local inference`),
    });
    try {
      await this.warm({ baseUrl, modelId });
      this.readyKey = key;
      events.emit({ type: "setup.status", status: readyStatus("local.agent.warmup", "local inference warm") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.emit({
        type: "setup.status",
        status: failedStatus("local.agent.warmup", `local inference warmup failed: ${message}`),
      });
      throw error;
    } finally {
      if (this.pending?.key === key) this.pending = null;
    }
  }
}
