import { homedir } from "node:os";
import path from "node:path";
import {
  DEFAULT_IDLE_PARK_MS,
  DEFAULT_MAX_LIVE_SANDBOXES,
  DEFAULT_SESSION_TTL_MS,
  WORKSPACE_ROOT_NAME,
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
  maxLiveSandboxes: number;
  workspaceRoot: string;
  botId: string;
  stateDir: string;
  stateDbPath: string;
  traceEnabled: boolean;
  tracesDir: string;
  globalMounts: GlobalMount[];
}

const keyByProvider: Record<string, string[]> = {
  openai: ["OPENAI_APIKEY", "OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_APIKEY"],
  "google-gemini": ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  ollama: [],
};

export function loadConfig(
  env = process.env,
  overrides: Partial<Pick<AppConfig, "traceEnabled">> = {},
): AppConfig {
  const aiProvider = env.AITHY_AI_PROVIDER ?? "openai";
  const aiApiKey = readApiKey(aiProvider, env);
  const sandboxProvider = parseSandboxProvider(env.AITHY_SANDBOX_PROVIDER);
  const botId = parseBotId(env.AITHY_BOT_ID);
  const stateDir = expandHome(env.AITHY_STATE_DIR ?? "~/.config/aithy");

  return {
    aiProvider,
    aiApiKey,
    aiModel: env.AITHY_AI_MODEL,
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
    maxLiveSandboxes: parsePositiveInt(
      env.AITHY_MAX_LIVE_SANDBOXES,
      DEFAULT_MAX_LIVE_SANDBOXES,
    ),
    workspaceRoot:
      env.AITHY_WORKSPACE_ROOT ?? `${process.cwd()}/${WORKSPACE_ROOT_NAME}`,
    botId,
    stateDir,
    stateDbPath: path.join(stateDir, botId, "state.db"),
    traceEnabled: overrides.traceEnabled ?? false,
    tracesDir: path.join(stateDir, botId, "traces"),
    globalMounts: [],
  };
}

function readApiKey(
  provider: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (env.AITHY_AI_APIKEY) return env.AITHY_AI_APIKEY;
  if (env.AITHY_AI_API_KEY) return env.AITHY_AI_API_KEY;

  const names = keyByProvider[provider] ?? [
    `${provider.toUpperCase()}_API_KEY`,
  ];
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return undefined;
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
