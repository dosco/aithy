/**
 * End-to-end smoke for the memory triage agent.
 *
 * Uses the configured primary provider + key, but writes to a tempdir SQLite
 * so it doesn't touch your real ~/.config/aithy state. Asks the triage agent
 * to remember a stable preference and verifies that a row actually lands in
 * the memories table — not just a confident summary string.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/env";
import { applyRuntimeSettings } from "../src/settings/resolve";
import { readProviderApiKey } from "../src/settings/secrets";
import { createMemoryAgent } from "../src/memory/memory-agent";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { LocalLlamaEmbedder } from "../src/local-inference/http-client";
import { probeAndConfigureSqlite } from "../src/memory/vec-extension";

const args = parseArgs(process.argv.slice(2));
const hybridMode = args.hybrid;

probeAndConfigureSqlite();

const dir = mkdtempSync(path.join(tmpdir(), "aithy-memsmoke-"));
const dbPath = path.join(dir, "state.db");

try {
  const baseConfig = loadConfig();
  const apiKey =
    baseConfig.aiApiKey ?? (await readProviderApiKey(baseConfig.aiProvider, baseConfig.botId));
  if (!apiKey) {
    console.error(`✗ no API key for provider="${baseConfig.aiProvider}"`);
    process.exit(2);
  }
  const config = applyRuntimeSettings(baseConfig, {}, apiKey, undefined);
  const stamped = { ...config, stateDbPath: dbPath };

  const baseUrl = args.localInferenceUrl?.trim();
  if (hybridMode && !baseUrl) {
    console.error("✗ set --url for --hybrid");
    process.exit(2);
  }
  const embedder = hybridMode && baseUrl
    ? new LocalLlamaEmbedder(() => baseUrl)
    : undefined;
  if (embedder) {
    console.log("loading embedder...");
    await embedder.init();
  }

  const memory = new SqliteMemoryStore(
    dbPath,
    embedder ? { embedder, log: (m) => console.log(`[memory] ${m}`) } : {},
  );
  const agent = createMemoryAgent({ config: stamped, memory });

  if (hybridMode) {
    console.log(
      `hybrid: vec=${memory.isHybridReady() ? "loaded" : "disabled"} model=${embedder?.modelId} dim=${embedder?.dim}`,
    );
  }

  console.log(
    `provider=${stamped.aiProvider} model=${stamped.aiModel || "<provider default>"}`,
  );

  const before = memory.rawCount();
  const out = await agent.forward({
    trigger: "explicit",
    hint: "remember that I always use ripgrep instead of grep",
    thread: [
      "[2026-05-08T17:00:00Z] user: hey aithy, please remember that I always use ripgrep instead of grep",
      "[2026-05-08T17:00:01Z] assistant: got it.",
    ].join("\n"),
  });
  const after = memory.rawCount();

  console.log(`summary: ${out.summary}`);
  console.log(`raw memory rows: before=${before} after=${after} delta=${after - before}`);
  for (const m of memory.recent(10)) {
    console.log(`- ${m.kind} | ${m.title}`);
    if (m.body) console.log(`  ${m.body.replace(/\n/g, " ")}`);
  }

  let hybridOk = true;
  if (hybridMode) {
    await memory.flushPendingEmbeds();
    const vecRows = (memory as unknown as { db: { query: (sql: string) => { get: () => { c: number } } } })
      .db.query("SELECT COUNT(*) AS c FROM memories_vec")
      .get();
    console.log(`vec rows: ${vecRows.c}`);
    if (after > before && vecRows.c < after) {
      hybridOk = false;
      console.log(
        "❌ hybrid: memories_vec row count behind memories — embed-on-write didn't fire",
      );
    }
  }

  if (after > before && hybridOk) {
    console.log("\n✅ PASS — a memory was actually written");
    process.exit(0);
  } else {
    console.log(
      "\n❌ FAIL — agent reported activity but nothing landed in the store",
    );
    process.exit(1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

function parseArgs(rawArgs: string[]): { hybrid: boolean; localInferenceUrl?: string } {
  let hybrid = false;
  let localInferenceUrl: string | undefined;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--hybrid") {
      hybrid = true;
      continue;
    }
    if (arg === "--url") {
      localInferenceUrl = rawArgs[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      localInferenceUrl = arg.slice("--url=".length);
    }
  }
  return { hybrid, localInferenceUrl };
}
