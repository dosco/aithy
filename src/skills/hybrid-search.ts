import { Database } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import { vecToBlob } from "../memory/embed-text";
import type { Reranker } from "../memory/rerank";
import { retrievalDiagnostics, sourceStats, type RetrievalDiagnostics } from "../retrieval/diagnostics";

interface SkillHit {
  id: string;
  text: string;
  rrf: number;
}

const RRF_K = 60;
const PER_RANKER_LIMIT = 30;

export async function hybridSkillSearch(input: {
  db: Database;
  embedder: Embedder;
  reranker: Reranker | null;
  rawQueries: readonly string[];
  ftsExpressions: readonly string[];
  perQueryLimit: number;
}): Promise<{ ids: string[]; diagnostics: RetrievalDiagnostics }> {
  const startedAt = performance.now();
  const perQuery = await Promise.all(input.rawQueries.map(async (query, index) => {
    const [fts, vec] = await Promise.all([
      runFts(input.db, input.ftsExpressions[index]),
      input.embedder.embedQuery(query).then((embedding) => runVec(input.db, embedding)).catch(() => [] as SkillHit[]),
    ]);
    return { fts, vec };
  }));
  const fused = new Map<string, SkillHit>();
  for (const { fts, vec } of perQuery) {
    addHits(fused, fts);
    addHits(fused, vec);
  }
  let candidates = [...fused.values()].sort((a, b) => b.rrf - a.rrf);
  let reranked = false;
  if (input.reranker?.available() && candidates.length > 0) {
    try {
      const scores = await input.reranker.rerank(input.rawQueries.join("\n"), candidates.map((hit) => hit.text));
      if (scores.length === candidates.length) {
        candidates = candidates
          .map((hit, index) => ({ hit, score: scores[index] }))
          .sort((a, b) => b.score - a.score)
          .map((item) => item.hit);
        reranked = true;
      }
    } catch {
      reranked = false;
    }
  }
  const ids = candidates.slice(0, input.rawQueries.length * input.perQueryLimit).map((hit) => hit.id);
  return {
    ids,
    diagnostics: retrievalDiagnostics({
      source: "skills",
      mode: reranked ? "hybrid-reranked" : "hybrid",
      queryCount: input.rawQueries.length,
      rerankerAvailable: Boolean(input.reranker?.available()),
      startedAt,
      sources: [sourceStats({
        source: "skills",
        ftsCandidates: perQuery.reduce((sum, item) => sum + item.fts.length, 0),
        vectorCandidates: perQuery.reduce((sum, item) => sum + item.vec.length, 0),
        fusedCandidates: fused.size,
        finalMatches: ids.length,
      })],
    }),
  };
}

function runFts(db: Database, expression: string): SkillHit[] {
  const rows = db
    .query(
      `SELECT s.id, s.name, s.description, s.when_to_use, s.tags
       FROM skills_fts f
       JOIN skills s ON s.rowid = f.rowid
       WHERE skills_fts MATCH $match
       ORDER BY rank
       LIMIT $limit`,
    )
    .all({ $match: expression, $limit: PER_RANKER_LIMIT }) as Array<{
      id: string;
      name: string;
      description: string;
      when_to_use: string | null;
      tags: string | null;
    }>;
  return rows.map((row, rank) => ({
    id: row.id,
    text: [row.name, row.description, row.when_to_use, row.tags].filter(Boolean).join("\n"),
    rrf: 1 / (RRF_K + rank),
  }));
}

function runVec(db: Database, embedding: Float32Array): SkillHit[] {
  const rows = db
    .query(
      `SELECT s.id, c.text
       FROM skills_vec v
       JOIN skill_embedding_chunks c ON c.id = v.rowid
       JOIN skills s ON s.id = c.skill_id
       WHERE v.embedding MATCH $vec
         AND k = $k
       ORDER BY v.distance`,
    )
    .all({ $vec: vecToBlob(embedding), $k: PER_RANKER_LIMIT } as never) as Array<{ id: string; text: string }>;
  return rows.map((row, rank) => ({ id: row.id, text: row.text, rrf: 1 / (RRF_K + rank) }));
}

function addHits(target: Map<string, SkillHit>, hits: readonly SkillHit[]): void {
  for (const hit of hits) {
    const existing = target.get(hit.id);
    if (existing) existing.rrf += hit.rrf;
    else target.set(hit.id, { ...hit });
  }
}
