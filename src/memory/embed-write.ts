import { Database } from "bun:sqlite";
import type { Embedder } from "./embed";
import { bodyHash, embedText, vecToBlob } from "./embed-text";
import { labelsFromJson } from "./labels";
import type { MemoryEntry } from "./types";

interface MemoryRow {
  id: string;
  rowid: number;
  title: string;
  body: string;
  labels: string;
  validFrom?: string | null;
  validUntil?: string | null;
  durationDays?: number | null;
  evidence?: string | null;
  frequency?: string | null;
}

export interface BackfillResult {
  done: number;
  skipped: number;
  indexed: Array<{ id: string; title: string; body: string }>;
}

const BACKFILL_BATCH_SIZE = 32;

/**
 * Embed `entry` and write into memories_vec + memory_embed_meta. Skips work
 * if the existing meta row has the same body_hash + model_id. Wraps the dual
 * write in a single transaction.
 */
export async function embedAndStore(
  db: Database,
  embedder: Embedder,
  entry: MemoryEntry,
): Promise<void> {
  const text = embedText(entry);
  const hash = bodyHash(text);
  const meta = db
    .query(
      `SELECT body_hash AS bh, model_id AS mid FROM memory_embed_meta WHERE memory_id = $id`,
    )
    .get({ $id: entry.id }) as { bh: string; mid: string } | undefined;
  if (meta && meta.bh === hash && meta.mid === embedder.modelId) return;

  const vector = await embedder.embed(text);
  const rowidRow = db
    .query("SELECT rowid FROM memories WHERE id = $id")
    .get({ $id: entry.id }) as { rowid: number } | undefined;
  if (!rowidRow) return; // memory deleted between upsert and embed completing

  const now = new Date().toISOString();
  db.transaction(() => {
    writeEmbedding(db, embedder, entry.id, rowidRow.rowid, hash, vector, now);
  })();
}

/**
 * Sweep memories needing (re)embedding. Idempotent and resumable: relies on
 * memory_embed_meta to skip up-to-date rows.
 */
export async function backfillEmbeddings(
  db: Database,
  embedder: Embedder,
  log: (msg: string) => void,
): Promise<BackfillResult> {
  const rows = db
    .query(
      `SELECT m.rowid AS rowid, m.id AS id, m.title AS title, m.body AS body, m.labels AS labels
              , m.valid_from AS validFrom, m.valid_until AS validUntil, m.duration_days AS durationDays
              , m.evidence AS evidence, m.frequency AS frequency
         FROM memories m
         WHERE m.superseded_by IS NULL`,
    )
    .all() as MemoryRow[];

  const stale: Array<MemoryRow & { computedHash: string }> = [];
  let skipped = 0;
  for (const row of rows) {
    const computedHash = bodyHash(embedText({ ...row, labels: labelsFromJson(row.labels) }));
    const meta = db
      .query(
        `SELECT body_hash AS bh, model_id AS mid, dim FROM memory_embed_meta WHERE memory_id = $id`,
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
    stale.push({ ...row, computedHash });
  }

  let done = 0;
  const indexed: BackfillResult["indexed"] = [];
  for (let i = 0; i < stale.length; i += BACKFILL_BATCH_SIZE) {
    const batch = stale.slice(i, i + BACKFILL_BATCH_SIZE);
    const vectors = await embedder.embedMany(batch.map((row) => embedText({ ...row, labels: labelsFromJson(row.labels) })));
    const now = new Date().toISOString();
    db.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        writeEmbedding(db, embedder, batch[j].id, batch[j].rowid, batch[j].computedHash, vectors[j], now);
      }
    })();
    done += batch.length;
    indexed.push(...batch.map(({ id, title, body }) => ({ id, title, body })));
    await new Promise((r) => setTimeout(r, 0));
  }

  if (done > 0 || skipped > 0) {
    log(`memory: backfill done=${done} skipped=${skipped}`);
  }
  return { done, skipped, indexed };
}

/**
 * Write a single embedding row pair. vec0 virtual tables don't support
 * UPSERT, so we delete-then-insert in the vec table while the meta row
 * uses normal ON CONFLICT.
 */
function writeEmbedding(
  db: Database,
  embedder: Embedder,
  memoryId: string,
  rowid: number,
  hash: string,
  vector: Float32Array,
  now: string,
): void {
  db.query("DELETE FROM memories_vec WHERE rowid = $rowid")
    .run({ $rowid: rowid } as never);
  db.query("INSERT INTO memories_vec(rowid, embedding) VALUES ($rowid, $vec)")
    .run({ $rowid: rowid, $vec: vecToBlob(vector) } as never);
  db.query(
    `INSERT INTO memory_embed_meta(memory_id, body_hash, model_id, dim, embedded_at)
       VALUES ($mid, $hash, $modelId, $dim, $now)
     ON CONFLICT(memory_id) DO UPDATE SET
       body_hash = excluded.body_hash,
       model_id = excluded.model_id,
       dim = excluded.dim,
       embedded_at = excluded.embedded_at`,
  ).run({
    $mid: memoryId,
    $hash: hash,
    $modelId: embedder.modelId,
    $dim: embedder.dim,
    $now: now,
  });
}
