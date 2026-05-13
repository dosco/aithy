import { homedir } from "node:os";
import path from "node:path";
import {
  DEFAULT_IDLE_PARK_MS,
  DEFAULT_PARALLEL_AGENTS,
  DEFAULT_SESSION_TTL_MS,
} from "./limits";

export type SandboxProviderKind = "microsandbox" | "disabled";

export interface GlobalMount {
  hostPath: string;
}

export interface AppConfig {
  aiProvider: string;
  aiApiKey?: string;
  aiModel?: string;
  fastAiProvider?: string;
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
  parallelSearchMcpUrl: string;
  parallelApiKey?: string;
  workspaceRoot: string;
  botId: string;
  stateDir: string;
  stateDbPath: string;
  traceEnabled: boolean;
  tracesDir: string;
  globalMounts: GlobalMount[];
}

export function loadConfig(
  env = process.env,
  overrides: Partial<Pick<AppConfig, "traceEnabled">> = {},
): AppConfig {
  const sandboxProvider = parseSandboxProvider(env.AITHY_SANDBOX_PROVIDER);
  const botId = parseBotId(env.AITHY_BOT_ID);
  const stateDir = expandHome(env.AITHY_STATE_DIR ?? "~/.config/aithy");

  return {
    aiProvider: "openai",
    sandboxProvider,
    sandboxImage: env.AITHY_SANDBOX_IMAGE ?? "python:3.11-slim",
    sandboxCpus: parsePositiveInt(env.AITHY_SANDBOX_CPUS, 1),
    sandboxMemoryMb: parsePositiveInt(env.AITHY_SANDBOX_MEMORY_MB, 512),
    sandboxNetwork: parseSandboxNetwork(env.AITHY_SANDBOX_NETWORK),
    sessionTtlMs: parsePositiveInt(
      env.AITHY_SESSION_TTL_MS,
      DEFAULT_SESSION_TTL_MS,
    ),
    idleParkMs: parsePositiveInt(
      env.AITHY_IDLE_PARK_MS,
      DEFAULT_IDLE_PARK_MS,
    ),
    parallelAgents: parsePositiveInt(
      env.AITHY_PARALLEL_AGENTS,
      DEFAULT_PARALLEL_AGENTS,
    ),
    parallelSearchMcpUrl:
      cleanString(env.AITHY_PARALLEL_SEARCH_MCP_URL)
      ?? "https://search.parallel.ai/mcp",
    parallelApiKey:
      cleanString(env.AITHY_PARALLEL_API_KEY)
      ?? cleanString(env.PARALLEL_API_KEY),
    workspaceRoot:
      env.AITHY_WORKSPACE_ROOT ?? path.join(stateDir, botId, "workspace"),
    botId,
    stateDir,
    stateDbPath: path.join(stateDir, botId, "state.db"),
    traceEnabled: overrides.traceEnabled ?? false,
    tracesDir: path.join(stateDir, botId, "traces"),
    globalMounts: [],
  };
}

function parseSandboxProvider(value?: string): SandboxProviderKind {
  if (value === "disabled" || value === "mock") return "disabled";
  return "microsandbox";
}

function parseSandboxNetwork(value?: string): AppConfig["sandboxNetwork"] {
  if (value === "public" || value === "allow-all") return value;
  return "none";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseBotId(value: string | undefined): string {
  const trimmed = value?.trim() || "default";
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "default";
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}
