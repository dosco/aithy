import type { Database } from "bun:sqlite";
import { addFusedHit, sortedFused, type FusedCandidate } from "../retrieval/fusion";
import { buildRetrievalQueryPlan } from "../retrieval/query-plan";
import type { SkillFileInput } from "./bundle";
import { activeSkillSql } from "./skills-store-helpers";
import type { SkillEntry, SkillUpsert } from "./types";

interface SkillChunkHit {
  id: string;
  text: string;
}

export function replaceSkillSearchChunks(
  db: Database,
  skill: Pick<SkillUpsert, "id" | "name" | "description" | "whenToUse" | "allowedTools" | "tags" | "body">,
  files: readonly SkillFileInput[],
  updatedAt: string,
): void {
  if (!tableExists(db, "skill_search_chunks")) return;
  db.query("DELETE FROM skill_search_chunks WHERE skill_id = $id").run({ $id: skill.id });
  const insert = db.query(
    `INSERT INTO skill_search_chunks(skill_id, chunk_key, text, updated_at)
     VALUES ($skillId, $chunkKey, $text, $updatedAt)`,
  );
  for (const chunk of skillSearchChunks(skill, files)) {
    insert.run({ $skillId: skill.id, $chunkKey: chunk.key, $text: chunk.text, $updatedAt: updatedAt });
  }
}

export function backfillSkillSearchChunks(db: Database, skills: readonly SkillEntry[]): void {
  if (!tableExists(db, "skill_search_chunks")) return;
  const row = db.query("SELECT COUNT(*) AS c FROM skill_search_chunks").get() as { c: number } | undefined;
  if ((row?.c ?? 0) > 0) return;
  const now = new Date().toISOString();
  for (const skill of skills) {
    replaceSkillSearchChunks(db, {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      whenToUse: skill.when_to_use,
      allowedTools: skill.allowed_tools,
      tags: skill.tags,
      body: skill.body,
    }, skill.files, now);
  }
}

export function searchSkillChunkIds(
  db: Database,
  queries: readonly string[],
  perQueryLimit: number,
): { ids: string[]; ftsCandidates: number; fusedCandidates: number } {
  if (!tableExists(db, "skill_search_chunks_fts")) return { ids: [], ftsCandidates: 0, fusedCandidates: 0 };
  const plan = buildRetrievalQueryPlan(queries);
  const fused = new Map<string, FusedCandidate<SkillChunkHit>>();
  let ftsCandidates = 0;
  for (const query of plan.lexicalQueries) {
    const rows = db
      .query(
        `SELECT s.id, c.text
         FROM skill_search_chunks_fts f
         JOIN skill_search_chunks c ON c.id = f.rowid
         JOIN skills s ON s.id = c.skill_id
         WHERE skill_search_chunks_fts MATCH $match
           AND ${activeSkillSql("s")}
         ORDER BY rank
         LIMIT $limit`,
      )
      .all({ $match: query.expression, $limit: 30 }) as SkillChunkHit[];
    ftsCandidates += rows.length;
    rows.forEach((row, rank) => addFusedHit(fused, row.id, row, query.lane, rank));
  }
  return {
    ids: sortedFused(fused).slice(0, Math.max(1, queries.length) * perQueryLimit).map((hit) => hit.item.id),
    ftsCandidates,
    fusedCandidates: fused.size,
  };
}

function skillSearchChunks(
  skill: Pick<SkillUpsert, "id" | "name" | "description" | "whenToUse" | "allowedTools" | "tags" | "body">,
  files: readonly SkillFileInput[],
): Array<{ key: string; text: string }> {
  const card = [
    skill.name,
    skill.description,
    skill.whenToUse ? `when to use: ${skill.whenToUse}` : null,
    skill.tags ? `tags: ${skill.tags}` : null,
    skill.allowedTools ? `tools: ${skill.allowedTools}` : null,
  ].filter(Boolean).join("\n");
  return [
    { key: "card", text: card },
    { key: "body", text: skill.body },
    ...files.map((file) => ({ key: `file:${file.path}`, text: `${file.path}\n${file.content}` })),
  ].filter((chunk) => chunk.text.trim().length > 0);
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = $name")
    .get({ $name: name }) as { name: string } | undefined;
  return Boolean(row);
}
