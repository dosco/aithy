import { Database } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import { vecToBlob } from "../memory/embed-text";
import type { Reranker } from "../memory/rerank";
import { retrievalDiagnostics, sourceStats, type RetrievalDiagnostics } from "../retrieval/diagnostics";
import { addFusedHit, sortedFused, type FusedCandidate } from "../retrieval/fusion";
import { buildRetrievalQueryPlan, type LexicalSearchQuery, type RetrievalLane } from "../retrieval/query-plan";

interface SkillHit {
  id: string;
  text: string;
  lane: RetrievalLane;
}

const PER_RANKER_LIMIT = 30;
const FUSED_CANDIDATE_LIMIT = 60;

export async function hybridSkillSearch(input: {
  db: Database;
  embedder: Embedder;
  reranker: Reranker | null;
  rawQueries: readonly string[];
  perQueryLimit: number;
}): Promise<{ ids: string[]; diagnostics: RetrievalDiagnostics }> {
  const startedAt = performance.now();
  const plan = buildRetrievalQueryPlan(input.rawQueries);
  const [ftsGroups, vecGroups] = await Promise.all([
    Promise.all(plan.lexicalQueries.map((query) => Promise.resolve(runFts(input.db, query)))),
    Promise.all(plan.semanticQueries.map((query) =>
      input.embedder.embedQuery(query).then((embedding) => runVec(input.db, embedding)).catch(() => [] as SkillHit[]),
    )),
  ]);
  const fused = new Map<string, FusedCandidate<SkillHit>>();
  for (const hits of [...ftsGroups, ...vecGroups]) addHits(fused, hits);
  let candidates = sortedFused(fused).slice(0, FUSED_CANDIDATE_LIMIT);
  let reranked = false;
  if (input.reranker?.available() && candidates.length > 0) {
    try {
      const scores = await input.reranker.rerank(input.rawQueries.join("\n"), candidates.map((hit) => hit.item.text));
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
  const ids = candidates.slice(0, input.rawQueries.length * input.perQueryLimit).map((hit) => hit.item.id);
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
        ftsCandidates: ftsGroups.reduce((sum, hits) => sum + hits.length, 0),
        vectorCandidates: vecGroups.reduce((sum, hits) => sum + hits.length, 0),
        fusedCandidates: fused.size,
        finalMatches: ids.length,
      })],
    }),
  };
}

function runFts(db: Database, query: LexicalSearchQuery): SkillHit[] {
  const rows = db
    .query(
      `SELECT s.id, c.text
       FROM skill_search_chunks_fts f
       JOIN skill_search_chunks c ON c.id = f.rowid
       JOIN skills s ON s.id = c.skill_id
       WHERE skill_search_chunks_fts MATCH $match
         AND NOT (s.source_kind = 'builtin' AND s.disabled_at IS NOT NULL)
       ORDER BY rank
       LIMIT $limit`,
    )
    .all({ $match: query.expression, $limit: PER_RANKER_LIMIT }) as Array<{
      id: string;
      text: string;
    }>;
  return rows.map((row, rank) => ({
    id: row.id,
    text: row.text,
    lane: query.lane,
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
         AND NOT (s.source_kind = 'builtin' AND s.disabled_at IS NOT NULL)
       ORDER BY v.distance`,
    )
    .all({ $vec: vecToBlob(embedding), $k: PER_RANKER_LIMIT } as never) as Array<{ id: string; text: string }>;
  return rows.map((row) => ({ id: row.id, text: row.text, lane: "semantic" }));
}

function addHits(target: Map<string, FusedCandidate<SkillHit>>, hits: readonly SkillHit[]): void {
  hits.forEach((hit, rank) => addFusedHit(target, hit.id, hit, hit.lane, rank));
}
