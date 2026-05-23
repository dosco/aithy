import { homedir } from "node:os";
import path from "node:path";
import {
  DEFAULT_IDLE_PARK_MS,
  DEFAULT_PARALLEL_AGENTS,
  DEFAULT_SESSION_TTL_MS,
} from "./limits";
import {
  DEFAULT_LOCAL_AGENT_MODEL_ID,
} from "../local-inference/manifest";
import { DEFAULT_OPENAI_MODEL } from "../agent/ai-providers";
import { defaultLocalInferenceSettings, type LocalInferenceSettings } from "../local-inference/settings";
import type { SearchProviderId } from "../settings/types";

export type SandboxProviderKind = "microsandbox" | "disabled";
export const DEFAULT_SANDBOX_IMAGE = "ghcr.io/dosco/aithy-sandbox:latest";
export const LEGACY_DEFAULT_SANDBOX_IMAGE = "python:3.11-slim";

export interface GlobalMount {
  hostPath: string;
}

export interface AppConfig {
  aiProvider: string;
  aiApiUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
  localAgentModel?: string;
  localInference: LocalInferenceSettings;
  fastAiProvider?: string;
  fastAiApiUrl?: string;
  fastAiApiKey?: string;
  fastAiModel?: string;
  sandboxProvider: SandboxProviderKind;
  sandboxImage: string;
  sandboxCpus: number;
  sandboxMemoryMb: number;
  sandboxNetwork: "none" | "public" | "allow-all";
  sessionTtlMs: number;
  idleParkMs: number;
  parallelAgents: number;
  searchProvider?: SearchProviderId;
  searchApiUrl?: string;
  parallelSearchMcpUrl: string;
  parallelApiKey?: string;
  grokSubscriptionConnected?: boolean;
  systemBashEnabled: boolean;
  workspaceRoot: string;
  outboxRoot: string;
  botId: string;
  stateDir: string;
  stateDbPath: string;
  traceEnabled: boolean;
  tracesDir: string;
  globalMounts: GlobalMount[];
}

export function loadConfig(
  overrides: Partial<Pick<AppConfig, "traceEnabled">> = {},
): AppConfig {
  const botId = "default";
  const stateDir = expandHome("~/.config/aithy");

  return {
    aiProvider: "openai",
    aiModel: DEFAULT_OPENAI_MODEL,
    localAgentModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
    localInference: defaultLocalInferenceSettings,
    sandboxProvider: "microsandbox",
    sandboxImage: DEFAULT_SANDBOX_IMAGE,
    sandboxCpus: 1,
    sandboxMemoryMb: 512,
    sandboxNetwork: "none",
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
    idleParkMs: DEFAULT_IDLE_PARK_MS,
    parallelAgents: DEFAULT_PARALLEL_AGENTS,
    searchProvider: "parallel",
    parallelSearchMcpUrl: "https://search.parallel.ai/mcp",
    grokSubscriptionConnected: false,
    systemBashEnabled: true,
    workspaceRoot: path.join(stateDir, botId, "workspace"),
    outboxRoot: path.join(stateDir, botId, "outbox"),
    botId,
    stateDir,
    stateDbPath: path.join(stateDir, botId, "state.db"),
    traceEnabled: overrides.traceEnabled ?? false,
    tracesDir: path.join(stateDir, botId, "traces"),
    globalMounts: [],
  };
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}
