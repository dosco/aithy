/**
 * Re-run memory triage over a stored session transcript.
 *
 * Usage:
 *   bun run memory <session id>
 *   bun run memory <session id> --hybrid
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, type AppConfig } from "../src/config/env";
import { assertStartupConfig } from "../src/config/validate";
import { createMemoryAgent } from "../src/memory/memory-agent";
import { EmbedService } from "../src/memory/embed";
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

const stateRoot = path.dirname(config.stateDbPath);
const embedder = args.hybrid
  ? new EmbedService({
      cacheDir: path.join(stateRoot, "cache"),
      log: (m) => console.error(`[embedder] ${m}`),
    })
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
  const flags = new Set(args.filter((arg) => arg.startsWith("-")));
  const sessionId = args.find((arg) => !arg.startsWith("-"));
  if (!sessionId) {
    printHelp();
    process.exit(2);
  }
  for (const flag of flags) {
    if (flag !== "--hybrid") {
      console.error(`Unknown flag: ${flag}`);
      printHelp();
      process.exit(2);
    }
  }
  return { sessionId, hybrid: flags.has("--hybrid") };
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
  console.log("Usage: bun run memory <session id> [--hybrid]");
}
