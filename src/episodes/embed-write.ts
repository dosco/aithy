import { Database } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import { vecToBlob } from "../memory/embed-text";
import { episodeEmbedText, episodeHash } from "./embed-text";
import type { AgentEpisodeEntry } from "./types";

interface EpisodeRow {
  id: string;
  rowid: number;
  task: string;
  approach: string;
  outcome: string;
  notes: string;
  tool_names: string;
  error: string | null;
}

export interface EpisodeBackfillResult {
  done: number;
  skipped: number;
  indexed: Array<{ id: string; task: string; notes: string }>;
}

const BACKFILL_BATCH_SIZE = 32;

export async function embedAndStoreEpisode(
  db: Database,
  embedder: Embedder,
  entry: AgentEpisodeEntry,
): Promise<void> {
  const text = episodeEmbedText(entry);
  const hash = episodeHash(text);
  const meta = db
    .query(
      `SELECT body_hash AS bh, model_id AS mid FROM agent_episode_embed_meta WHERE episode_id = $id`,
    )
    .get({ $id: entry.id }) as { bh: string; mid: string } | undefined;
  if (meta && meta.bh === hash && meta.mid === embedder.modelId) return;

  const vector = await embedder.embed(text);
  const rowidRow = db
    .query("SELECT rowid FROM agent_episodes WHERE id = $id")
    .get({ $id: entry.id }) as { rowid: number } | undefined;
  if (!rowidRow) return;

  const now = new Date().toISOString();
  db.transaction(() => {
    writeEpisodeEmbedding(db, embedder, entry.id, rowidRow.rowid, hash, vector, now);
  })();
}

export async function backfillEpisodeEmbeddings(
  db: Database,
  embedder: Embedder,
  log: (msg: string) => void,
): Promise<EpisodeBackfillResult> {
  const rows = db
    .query(
      `SELECT rowid, id, task, approach, outcome, notes, tool_names, error
         FROM agent_episodes`,
    )
    .all() as EpisodeRow[];

  const stale: Array<EpisodeRow & { computedHash: string; toolNames: string[] }> = [];
  let skipped = 0;
  for (const row of rows) {
    const toolNames = parseJsonStringArray(row.tool_names);
    const computedHash = episodeHash(episodeEmbedText({ ...row, toolNames }));
    const meta = db
      .query(
        `SELECT body_hash AS bh, model_id AS mid, dim FROM agent_episode_embed_meta WHERE episode_id = $id`,
      )
      .get({ $id: row.id }) as { bh: string; mid: string; dim: number } | undefined;
    if (
      meta &&
      meta.bh === computedHash &&
      meta.mid === embedder.modelId &&
      meta.dim === embedder.dim
    ) {
      skipped += 1;
      continue;
    }
    stale.push({ ...row, computedHash, toolNames });
  }

  let done = 0;
  const indexed: EpisodeBackfillResult["indexed"] = [];
  for (let i = 0; i < stale.length; i += BACKFILL_BATCH_SIZE) {
    const batch = stale.slice(i, i + BACKFILL_BATCH_SIZE);
    const vectors = await embedder.embedMany(batch.map((row) => episodeEmbedText(row)));
    const now = new Date().toISOString();
    db.transaction(() => {
      for (let j = 0; j < batch.length; j += 1) {
        writeEpisodeEmbedding(db, embedder, batch[j].id, batch[j].rowid, batch[j].computedHash, vectors[j], now);
      }
    })();
    done += batch.length;
    indexed.push(...batch.map(({ id, task, notes }) => ({ id, task, notes })));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (done > 0) log(`episodes: backfill done=${done} skipped=${skipped}`);
  return { done, skipped, indexed };
}

function writeEpisodeEmbedding(
  db: Database,
  embedder: Embedder,
  episodeId: string,
  rowid: number,
  hash: string,
  vector: Float32Array,
  now: string,
): void {
  db.query("DELETE FROM agent_episodes_vec WHERE rowid = $rowid")
    .run({ $rowid: rowid } as never);
  db.query("INSERT INTO agent_episodes_vec(rowid, embedding) VALUES ($rowid, $vec)")
    .run({ $rowid: rowid, $vec: vecToBlob(vector) } as never);
  db.query(
    `INSERT INTO agent_episode_embed_meta(episode_id, body_hash, model_id, dim, embedded_at)
       VALUES ($eid, $hash, $modelId, $dim, $now)
     ON CONFLICT(episode_id) DO UPDATE SET
       body_hash = excluded.body_hash,
       model_id = excluded.model_id,
       dim = excluded.dim,
       embedded_at = excluded.embedded_at`,
  ).run({
    $eid: episodeId,
    $hash: hash,
    $modelId: embedder.modelId,
    $dim: embedder.dim,
    $now: now,
  });
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
