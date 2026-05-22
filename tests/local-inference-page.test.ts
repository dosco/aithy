import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { LocalInferencePanel } from "../app/components/local-inference-page";
import { loadConfig } from "../src/config/env";
import {
  DEFAULT_LOCAL_AGENT_MODEL,
  DEFAULT_LOCAL_AGENT_MODEL_ID,
  LOCAL_AI_PROVIDER,
  MANAGED_LOCAL_CHAT_MODELS,
} from "../src/local-inference/manifest";
import type { LocalInferencePageStateDto } from "../app/server/dto";

describe("LocalInferencePanel", () => {
  test("disables local chat controls until Local is selected", () => {
    const html = renderToStaticMarkup(React.createElement(LocalInferencePanel, {
      initialState: pageState(),
    }));

    expect(html).toContain("Select Local in Models to start a local chat model.");
    expect(localChatInput(html)).toContain("disabled=\"\"");
    expect(html).toContain(DEFAULT_LOCAL_AGENT_MODEL.label);
  });

  test("enables local chat controls when Local is selected", () => {
    const html = renderToStaticMarkup(React.createElement(LocalInferencePanel, {
      initialState: pageState({
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      }),
    }));

    expect(html).not.toContain("Select Local in Models to start a local chat model.");
    expect(localChatInput(html)).not.toContain("disabled=\"\"");
  });
});

function pageState(configPatch: Partial<ReturnType<typeof loadConfig>> = {}): LocalInferencePageStateDto {
  const config = { ...loadConfig({}), ...configPatch };
  return {
    settings: {
      runtime: {},
      ui: {
        theme: "paper",
        colorMode: "system",
        layout: "chat",
        detailsDefault: false,
        lastActiveSessionId: null,
      },
      updatedAt: new Date().toISOString(),
    },
    config: {
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
      sandboxCpus: config.sandboxCpus,
      sandboxMemoryMb: config.sandboxMemoryMb,
      sandboxNetwork: config.sandboxNetwork,
      sessionTtlMs: config.sessionTtlMs,
      parallelAgents: config.parallelAgents,
      searchProvider: config.searchProvider ?? "parallel",
      searchApiUrl: config.searchApiUrl ?? "",
      parallelSearchMcpUrl: config.parallelSearchMcpUrl,
      systemBashEnabled: config.systemBashEnabled,
      traceEnabled: config.traceEnabled,
      botId: config.botId,
      stateDbPath: config.stateDbPath,
      workspaceRoot: config.workspaceRoot,
      globalMounts: [],
      aiProviderProfiles: {},
      searchProviderProfiles: {},
    },
    status: {
      required: false,
      routerRequired: true,
      routerReady: true,
      routerActive: false,
      chatRequired: config.aiProvider === LOCAL_AI_PROVIDER,
      chatReady: config.aiProvider === LOCAL_AI_PROVIDER,
      ready: true,
      active: false,
      error: null,
      modelId: config.localAgentModel ?? DEFAULT_LOCAL_AGENT_MODEL_ID,
      baseUrl: "http://127.0.0.1:1234",
      cacheDir: "/tmp/hf",
      binaryPath: null,
      binarySource: null,
      modelsIniPath: null,
      embeddingHealth: null,
    },
    localModels: MANAGED_LOCAL_CHAT_MODELS.map((model) => ({
      id: model.id,
      repoId: model.repoId,
      filename: model.filename,
      displayName: model.label,
      alias: model.alias,
      role: model.role,
      path: "",
      sizeBytes: 0,
      managed: true,
      cached: false,
    })),
    selectedLocalAgentModel: config.localAgentModel ?? DEFAULT_LOCAL_AGENT_MODEL_ID,
    defaultLocalAgentModel: {
      id: DEFAULT_LOCAL_AGENT_MODEL_ID,
      repoId: DEFAULT_LOCAL_AGENT_MODEL.repoId,
      filename: DEFAULT_LOCAL_AGENT_MODEL.filename,
      displayName: DEFAULT_LOCAL_AGENT_MODEL.label,
      alias: DEFAULT_LOCAL_AGENT_MODEL.alias,
      role: DEFAULT_LOCAL_AGENT_MODEL.role,
      path: "",
      sizeBytes: 0,
      managed: true,
      cached: false,
    },
    coreModels: [],
    embeddingModel: "embedding",
    rankingModel: "reranker",
    setupStatuses: [],
  };
}

function localChatInput(html: string): string {
  const pattern = new RegExp(`<input[^>]*value="${escapeRegExp(DEFAULT_LOCAL_AGENT_MODEL.label)}"[^>]*>`);
  return html.match(pattern)?.[0] ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
