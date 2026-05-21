/**
 * Re-run memory triage over a stored session transcript.
 *
 * Usage:
 *   bun run memory <session id>
 *   bun run memory <session id> --hybrid
 */
import { existsSync } from "node:fs";
import { loadConfig, type AppConfig } from "../src/config/env";
import { assertStartupConfig } from "../src/config/validate";
import { createMemoryAgent } from "../src/memory/memory-agent";
import { LocalLlamaEmbedder } from "../src/local-inference/http-client";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { probeAndConfigureSqlite } from "../src/memory/vec-extension";
import { applyRuntimeSettings } from "../src/settings/resolve";
import { readProviderApiKey } from "../src/settings/secrets";
import { SqliteSettingsStore } from "../src/settings/store";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import type { BotMessage } from "../src/session/types";

interface Args {
  sessionId: string;
  hybrid: boolean;
  localInferenceUrl?: string;
}

const args = parseArgs(process.argv.slice(2));
if (args.hybrid) probeAndConfigureSqlite();

const baseConfig = loadConfig();
if (!existsSync(baseConfig.stateDbPath)) {
  console.error(`Database not found: ${baseConfig.stateDbPath}`);
  process.exit(1);
}

const settings = new SqliteSettingsStore(baseConfig.stateDbPath);
const config = await effectiveConfig(baseConfig, settings);
settings.close();
assertStartupConfig(config);

const sessions = new SqliteSessionStateStore(config.stateDbPath);
const session = sessions.loadSession(args.sessionId);
sessions.close();
if (!session) {
  console.error(`Session not found: ${args.sessionId}`);
  process.exit(1);
}
if (session.messages.length === 0) {
  console.log(`Session ${args.sessionId} has no messages; nothing to reprocess.`);
  process.exit(0);
}

const baseUrl = args.localInferenceUrl?.trim();
if (args.hybrid && !baseUrl) {
  console.error("Set --url for --hybrid.");
  process.exit(1);
}
const embedder = args.hybrid
  ? new LocalLlamaEmbedder(() => baseUrl ?? null)
  : undefined;
if (embedder) {
  console.error("loading embedder...");
  await embedder.init();
}

const memory = new SqliteMemoryStore(config.stateDbPath, {
  ...(embedder ? { embedder } : {}),
  log: (m) => console.error(`[memory] ${m}`),
});

const agent = createMemoryAgent({ config, memory });
const before = memory.rawCount();
const out = await agent.forward({
  trigger: "auto",
  thread: formatThread(session.messages),
});
await memory.flushPendingEmbeds();
const after = memory.rawCount();
const delta = after - before;

console.log(`session: ${session.conversationId} (${session.messages.length} messages)`);
console.log(`summary: ${out.summary}`);
console.log(`memory rows: before=${before} after=${after} delta=${delta}`);
if (delta > 0) {
  for (const m of memory.recent(Math.min(delta, 10))) {
    console.log(`- ${m.kind} | ${m.title}`);
    if (m.body) console.log(`  ${m.body.replace(/\n/g, " ")}`);
  }
}
memory.close();

async function effectiveConfig(
  baseConfig: AppConfig,
  settings: SqliteSettingsStore,
): Promise<AppConfig> {
  const stored = settings.load();
  const provider = stored.runtime.aiProvider?.trim() || baseConfig.aiProvider;
  const apiKey =
    stored.runtime.aiApiKey === null
      ? null
      : baseConfig.aiApiKey ?? await readProviderApiKey(provider, baseConfig.botId);
  return applyRuntimeSettings(baseConfig, stored.runtime, apiKey, undefined);
}

function formatThread(messages: readonly BotMessage[]): string {
  return messages
    .map((m) => {
      if (m.role === "user") return `[${m.createdAt}] user: ${m.content}`;
      if (m.kind === "text") return `[${m.createdAt}] assistant: ${m.content}`;
      if (m.kind === "permission") return `[${m.createdAt}] permission ${m.toolName}: ${m.status}`;
      if (m.kind === "artifact") return `[${m.createdAt}] artifact ${m.title}: ${m.sandboxPath}`;
      return `[${m.createdAt}] tool ${m.toolName}: ${safeJson(m.toolArgs)}`;
    })
    .join("\n");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "[unserializable]";
  }
}

function parseArgs(rawArgs: string[]): Args {
  const args = normalizeArgs(rawArgs);
  if (args[0] === "-h" || args[0] === "--help") {
    printHelp();
    process.exit(0);
  }
  const flags = new Set(args.filter((arg) => arg.startsWith("-") && arg !== "--url"));
  let localInferenceUrl: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--url") {
      localInferenceUrl = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      localInferenceUrl = arg.slice("--url=".length);
      continue;
    }
    if (!arg.startsWith("-")) positional.push(arg);
  }
  const sessionId = positional[0];
  if (!sessionId) {
    printHelp();
    process.exit(2);
  }
  for (const flag of flags) {
    if (flag !== "--hybrid" && !flag.startsWith("--url=")) {
      console.error(`Unknown flag: ${flag}`);
      printHelp();
      process.exit(2);
    }
  }
  return { sessionId, hybrid: flags.has("--hybrid"), localInferenceUrl };
}

function normalizeArgs(args: string[]): string[] {
  const filtered = args.filter((arg) => arg !== "--");
  if (filtered[0] === "run" && filtered[1] === "memory") return filtered.slice(2);
  if (filtered[0] === "memory") return filtered.slice(1);
  if (filtered[0]?.endsWith("/scripts/memory.ts") || filtered[0]?.endsWith("\\scripts\\memory.ts")) {
    return filtered.slice(1);
  }
  return filtered;
}

function printHelp(): void {
  console.log("Usage: bun run memory <session id> [--hybrid --url <local inference base URL>]");
}
