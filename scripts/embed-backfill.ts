/**
 * Embed every memory missing an up-to-date row in `memory_embed_meta` against
 * the user's real SQLite state. Useful after upgrading the embedding model or
 * after running for a while without hybrid mode.
 *
 * Idempotent and resumable — run as many times as you like.
 */
import { loadConfig } from "../src/config/env";
import { LocalLlamaEmbedder } from "../src/local-inference/http-client";
import { SqliteMemoryStore } from "../src/memory/memory-store";
import { probeAndConfigureSqlite } from "../src/memory/vec-extension";

probeAndConfigureSqlite();

const config = loadConfig();
const baseUrl = localInferenceUrlFromArgs(process.argv.slice(2));
if (!baseUrl) {
  console.error("✗ set --url to a running llama-server router base URL");
  process.exit(1);
}

const embedder = new LocalLlamaEmbedder(() => baseUrl);

console.error("loading embedder...");
await embedder.init();
const initFailure = embedder.initFailureReason();
if (initFailure) {
  console.error(`✗ embedder init failed: ${initFailure}`);
  process.exit(1);
}

const memory = new SqliteMemoryStore(config.stateDbPath, {
  embedder,
  log: (m) => console.error(`[memory] ${m}`),
});

if (!memory.isHybridReady()) {
  console.error("✗ hybrid not available — sqlite-vec extension didn't load");
  process.exit(1);
}

console.error(`backfilling embeddings (model=${embedder.modelId} dim=${embedder.dim})...`);
const t0 = Date.now();
const result = await memory.backfillEmbeddings();
const elapsed = Date.now() - t0;
console.error(`done=${result.done} skipped=${result.skipped} elapsed=${elapsed}ms`);
process.exit(0);

function localInferenceUrlFromArgs(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--url") return args[i + 1]?.trim();
    if (arg.startsWith("--url=")) return arg.slice("--url=".length).trim();
  }
  return undefined;
}
