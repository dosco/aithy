import { Database } from "bun:sqlite";
import type { Embedder } from "./embed";
import { bodyHash, embedText, vecToBlob } from "./embed-text";
import type { MemoryEntry } from "./types";
import type { EmbeddingHealthStats, TargetIndexCounts, TargetIndexStatus } from "../retrieval/indexing";

interface MemoryRow {
  id: string;
  rowid: number;
  subject?: string | null;
  scopeKind?: string | null;
  scopeRef?: string | null;
  guidance?: string | null;
  title: string;
  body: string;
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
): Promise<TargetIndexStatus> {
  const text = embedText(entry);
  const hash = bodyHash(text);
  const meta = db
    .query(
      `SELECT body_hash AS bh, model_id AS mid, dim FROM memory_embed_meta WHERE memory_id = $id`,
    )
    .get({ $id: entry.id }) as { bh: string; mid: string; dim: number } | undefined;
  if (meta && meta.bh === hash && meta.mid === embedder.modelId && meta.dim === embedder.dim) return "skipped";

  const vector = await embedder.embed(text);
  const rowidRow = db
    .query("SELECT rowid FROM memories WHERE id = $id")
    .get({ $id: entry.id }) as { rowid: number } | undefined;
  if (!rowidRow) return "missing"; // memory deleted between upsert and embed completing

  const now = new Date().toISOString();
  db.transaction(() => {
    writeEmbedding(db, embedder, entry.id, rowidRow.rowid, hash, vector, now);
  })();
  return "indexed";
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
      `SELECT m.rowid AS rowid, m.id AS id, m.title AS title, m.body AS body
              , m.subject AS subject, m.scope_kind AS scopeKind, m.scope_ref AS scopeRef
              , m.guidance AS guidance
              , m.valid_from AS validFrom, m.valid_until AS validUntil, m.duration_days AS durationDays
              , m.evidence AS evidence, m.frequency AS frequency
         FROM memories m
         WHERE m.superseded_by IS NULL`,
    )
    .all() as MemoryRow[];

  const stale: Array<MemoryRow & { computedHash: string }> = [];
  let skipped = 0;
  for (const row of rows) {
    const computedHash = bodyHash(embedText(row));
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
    const vectors = await embedder.embedMany(batch.map((row) => embedText(row)));
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

  if (done > 0) {
    log(`memory: backfill done=${done} skipped=${skipped}`);
  }
  return { done, skipped, indexed };
}

export function memoryEmbeddingStats(
  db: Database,
  embedder: Embedder | null,
): EmbeddingHealthStats {
  const rows = db
    .query(
      `SELECT m.id AS id, m.title AS title, m.body AS body,
              m.subject AS subject, m.scope_kind AS scopeKind, m.scope_ref AS scopeRef,
              m.guidance AS guidance,
              m.valid_from AS validFrom, m.valid_until AS validUntil,
              m.duration_days AS durationDays, m.evidence AS evidence,
              m.frequency AS frequency, meta.body_hash AS bodyHash,
              meta.model_id AS modelId, meta.dim AS dim
         FROM memories m
         LEFT JOIN memory_embed_meta meta ON meta.memory_id = m.id
         WHERE m.superseded_by IS NULL`,
    )
    .all() as Array<MemoryRow & { bodyHash: string | null; modelId: string | null; dim: number | null }>;
  if (!embedder) return { total: rows.length, embedded: 0, stale: rows.length };
  let embedded = 0;
  for (const row of rows) {
    if (
      row.bodyHash === bodyHash(embedText(row))
      && row.modelId === embedder.modelId
      && row.dim === embedder.dim
    ) embedded += 1;
  }
  return { total: rows.length, embedded, stale: rows.length - embedded };
}

export async function indexMemoryEmbeddings(
  db: Database,
  embedder: Embedder | null,
  ids: readonly string[],
  get: (id: string) => MemoryEntry | null,
): Promise<TargetIndexCounts> {
  if (!embedder) return { indexed: 0, skipped: 0, missing: 0, failed: ids.length };
  const counts: TargetIndexCounts = { indexed: 0, skipped: 0, missing: 0, failed: 0 };
  for (const id of ids) {
    const entry = get(id);
    if (!entry) {
      counts.missing += 1;
      continue;
    }
    try {
      counts[await embedAndStore(db, embedder, entry)] += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return counts;
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
