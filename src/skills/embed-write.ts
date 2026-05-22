import { Database } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import { vecToBlob } from "../memory/embed-text";
import type { SkillEntry } from "./types";
import { skillChunkHash, skillEmbeddingChunks } from "./embed-text";
import type { EmbeddingHealthStats, TargetIndexCounts, TargetIndexStatus } from "../retrieval/indexing";

export async function embedAndStoreSkill(
  db: Database,
  embedder: Embedder,
  skill: SkillEntry,
): Promise<TargetIndexStatus> {
  const chunks = skillEmbeddingChunks(skill);
  if (chunks.length === 0) return "skipped";
  const existing = db
    .query(
      `SELECT id, chunk_key AS chunkKey, body_hash AS bodyHash, model_id AS modelId, dim
       FROM skill_embedding_chunks
       WHERE skill_id = $skillId`,
    )
    .all({ $skillId: skill.id }) as Array<{
      id: number;
      chunkKey: string;
      bodyHash: string;
      modelId: string;
      dim: number;
    }>;
  const byKey = new Map(existing.map((row) => [row.chunkKey, row]));
  const wantedKeys = new Set(chunks.map((chunk) => chunk.key));
  const stale = chunks.filter((chunk) => {
    const row = byKey.get(chunk.key);
    return !row
      || row.bodyHash !== skillChunkHash(chunk.text)
      || row.modelId !== embedder.modelId
      || row.dim !== embedder.dim;
  });
  const removed = existing.filter((row) => !wantedKeys.has(row.chunkKey));
  if (stale.length === 0 && removed.length === 0) return "skipped";

  const vectors = await embedder.embedMany(stale.map((chunk) => chunk.text));
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const row of removed) deleteChunk(db, row.id);
    stale.forEach((chunk, index) => writeChunk(db, embedder, skill.id, chunk.key, chunk.text, vectors[index], now));
  })();
  return "indexed";
}

export async function backfillSkillEmbeddings(
  db: Database,
  embedder: Embedder,
  skills: readonly SkillEntry[],
): Promise<{ done: number; skipped: number; indexed: Array<{ id: string; name: string }> }> {
  let done = 0;
  let skipped = 0;
  const indexed: Array<{ id: string; name: string }> = [];
  for (const skill of skills) {
    const status = await embedAndStoreSkill(db, embedder, skill);
    if (status === "indexed") {
      done += 1;
      indexed.push({ id: skill.id, name: skill.name });
    } else if (status === "skipped") {
      skipped += 1;
    }
  }
  return { done, skipped, indexed };
}

export function skillEmbeddingStats(
  db: Database,
  embedder: Embedder | null,
  skills: readonly SkillEntry[],
): EmbeddingHealthStats {
  if (!embedder) return { total: skills.length, embedded: 0, stale: skills.length };
  let embedded = 0;
  let stale = 0;
  for (const skill of skills) {
    const chunks = skillEmbeddingChunks(skill);
    if (chunks.length === 0) {
      embedded += 1;
      continue;
    }
    const rows = db
      .query(
        `SELECT chunk_key AS chunkKey, body_hash AS bodyHash, model_id AS modelId, dim
         FROM skill_embedding_chunks
         WHERE skill_id = $skillId`,
      )
      .all({ $skillId: skill.id }) as Array<{ chunkKey: string; bodyHash: string; modelId: string; dim: number }>;
    const byKey = new Map(rows.map((row) => [row.chunkKey, row]));
    const upToDate = chunks.every((chunk) => {
      const row = byKey.get(chunk.key);
      return row
        && row.bodyHash === skillChunkHash(chunk.text)
        && row.modelId === embedder.modelId
        && row.dim === embedder.dim;
    });
    if (upToDate) embedded += 1;
    else stale += 1;
  }
  return { total: skills.length, embedded, stale };
}

export async function indexSkillEmbeddings(
  db: Database,
  embedder: Embedder | null,
  ids: readonly string[],
  get: (id: string) => SkillEntry | null,
): Promise<TargetIndexCounts> {
  if (!embedder) return { indexed: 0, skipped: 0, missing: 0, failed: ids.length };
  const counts: TargetIndexCounts = { indexed: 0, skipped: 0, missing: 0, failed: 0 };
  for (const id of ids) {
    const skill = get(id);
    if (!skill) {
      counts.missing += 1;
      continue;
    }
    try {
      counts[await embedAndStoreSkill(db, embedder, skill)] += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return counts;
}

function writeChunk(
  db: Database,
  embedder: Embedder,
  skillId: string,
  chunkKey: string,
  text: string,
  vector: Float32Array,
  now: string,
): void {
  const existing = db
    .query("SELECT id FROM skill_embedding_chunks WHERE skill_id = $skillId AND chunk_key = $chunkKey")
    .get({ $skillId: skillId, $chunkKey: chunkKey }) as { id: number } | undefined;
  const id = existing?.id ?? insertChunk(db, skillId, chunkKey, text, skillChunkHash(text), embedder, now);
  if (existing) {
    db.query(
      `UPDATE skill_embedding_chunks
       SET text = $text, body_hash = $hash, model_id = $modelId, dim = $dim, embedded_at = $now
       WHERE id = $id`,
    ).run({ $id: id, $text: text, $hash: skillChunkHash(text), $modelId: embedder.modelId, $dim: embedder.dim, $now: now });
  }
  db.query("DELETE FROM skills_vec WHERE rowid = $rowid").run({ $rowid: id } as never);
  db.query("INSERT INTO skills_vec(rowid, embedding) VALUES ($rowid, $vec)")
    .run({ $rowid: id, $vec: vecToBlob(vector) } as never);
}

function insertChunk(
  db: Database,
  skillId: string,
  chunkKey: string,
  text: string,
  hash: string,
  embedder: Embedder,
  now: string,
): number {
  const row = db.query(
    `INSERT INTO skill_embedding_chunks(skill_id, chunk_key, text, body_hash, model_id, dim, embedded_at)
     VALUES ($skillId, $chunkKey, $text, $hash, $modelId, $dim, $now)
     RETURNING id`,
  ).get({ $skillId: skillId, $chunkKey: chunkKey, $text: text, $hash: hash, $modelId: embedder.modelId, $dim: embedder.dim, $now: now }) as { id: number } | undefined;
  return Number(row?.id);
}

function deleteChunk(db: Database, id: number): void {
  db.query("DELETE FROM skills_vec WHERE rowid = $id").run({ $id: id } as never);
  db.query("DELETE FROM skill_embedding_chunks WHERE id = $id").run({ $id: id });
}
