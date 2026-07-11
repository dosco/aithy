import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";

export interface SkillEvalDefinition { request: string; criteria: string }
export type SkillEvalCaseStatus = "passed" | "failed" | "blocked";
export interface SkillEvalCaseResult extends SkillEvalDefinition {
  status: SkillEvalCaseStatus; response: string; toolCalls: unknown[]; score: number | null; rationale: string;
}
export interface SkillEvalRun {
  id: string; skillId: string; status: "running" | "completed" | "failed"; score: number | null;
  cases: SkillEvalCaseResult[]; model: string | null; error: string | null; createdAt: string; completedAt: string | null;
}
export type SkillEvalRunSummary = Pick<SkillEvalRun, "id" | "skillId" | "status" | "score" | "model" | "error" | "createdAt" | "completedAt"> & { caseCount: number };
export function skillEvalRunSummary(run: SkillEvalRun): SkillEvalRunSummary { const { cases, ...rest } = run; return { ...rest, caseCount: cases.length }; }

export function ensureSkillEvalSchema(db: Database): void {
  applySqliteMigrations(db, "skill-eval", [{ version: 1, sql: `
    ALTER TABLE skills ADD COLUMN evals_json TEXT NOT NULL DEFAULT '[]';
    CREATE TABLE skill_eval_runs (
      id TEXT PRIMARY KEY, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      status TEXT NOT NULL, score REAL, cases_json TEXT NOT NULL DEFAULT '[]', model TEXT,
      error TEXT, created_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE INDEX skill_eval_runs_skill_idx ON skill_eval_runs(skill_id, created_at DESC);
  ` }]);
}

export function validateSkillEvals(value: unknown): SkillEvalDefinition[] {
  if (!Array.isArray(value)) throw new Error("Skill evals must be a JSON array.");
  if (value.length > 5) throw new Error("A skill can define at most five authored eval cases.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Eval case ${index + 1} must be an object.`);
    const request = String((item as { request?: unknown }).request ?? "").trim();
    const criteria = String((item as { criteria?: unknown }).criteria ?? "").trim();
    if (!request || !criteria) throw new Error(`Eval case ${index + 1} requires request and criteria strings.`);
    if (request.length > 4_000 || criteria.length > 4_000) throw new Error(`Eval case ${index + 1} is too long.`);
    return { request, criteria };
  });
}

export function parseSkillEvalsJson(raw: string | null | undefined): SkillEvalDefinition[] {
  if (!raw) return [];
  try { return validateSkillEvals(JSON.parse(raw)); } catch { return []; }
}

export function parseAuthoredEvals(raw: string): SkillEvalDefinition[] {
  const trimmed = raw.trim();
  return trimmed ? validateSkillEvals(JSON.parse(trimmed)) : [];
}

export function setSkillEvals(db: Database, id: string, evals: readonly SkillEvalDefinition[]): void {
  const result = db.query("UPDATE skills SET evals_json = $evals WHERE id = $id")
    .run({ $id: id, $evals: JSON.stringify(validateSkillEvals(evals)) });
  if (result.changes === 0) throw new Error(`Skill not found: ${id}`);
}

export class SqliteSkillEvalStore {
  private readonly db: Database;
  constructor(dbPath: string) { this.db = new Database(dbPath, { create: true }); this.db.exec("PRAGMA foreign_keys = ON;"); ensureSkillEvalSchema(this.db); }
  start(skillId: string, model: string | null): SkillEvalRun {
    const run: SkillEvalRun = { id: crypto.randomUUID(), skillId, status: "running", score: null, cases: [], model,
      error: null, createdAt: new Date().toISOString(), completedAt: null };
    this.db.query(`INSERT INTO skill_eval_runs (id, skill_id, status, score, cases_json, model, error, created_at, completed_at)
      VALUES ($id, $skillId, $status, NULL, '[]', $model, NULL, $createdAt, NULL)`).run(bindRun(run));
    return run;
  }
  complete(id: string, cases: SkillEvalCaseResult[]): SkillEvalRun {
    const score = aggregateScore(cases); const completedAt = new Date().toISOString();
    this.db.query("UPDATE skill_eval_runs SET status = 'completed', score = $score, cases_json = $cases, completed_at = $completedAt WHERE id = $id")
      .run({ $id: id, $score: score, $cases: JSON.stringify(cases), $completedAt: completedAt });
    return this.get(id)!;
  }
  fail(id: string, error: string): SkillEvalRun {
    this.db.query("UPDATE skill_eval_runs SET status = 'failed', error = $error, completed_at = $completedAt WHERE id = $id")
      .run({ $id: id, $error: error.slice(0, 4_000), $completedAt: new Date().toISOString() });
    return this.get(id)!;
  }
  get(id: string): SkillEvalRun | null { const row = this.db.query("SELECT * FROM skill_eval_runs WHERE id = $id").get({ $id: id }); return row ? runFromRow(row as RunRow) : null; }
  recent(skillId: string, limit = 10): SkillEvalRun[] { return (this.db.query("SELECT * FROM skill_eval_runs WHERE skill_id = $skillId ORDER BY created_at DESC LIMIT $limit")
    .all({ $skillId: skillId, $limit: Math.max(1, Math.min(50, limit)) }) as RunRow[]).map(runFromRow); }
  close(): void { this.db.close(); }
}

interface RunRow { id: string; skill_id: string; status: SkillEvalRun["status"]; score: number | null; cases_json: string; model: string | null; error: string | null; created_at: string; completed_at: string | null }
function runFromRow(row: RunRow): SkillEvalRun { return { id: row.id, skillId: row.skill_id, status: row.status, score: row.score,
  cases: JSON.parse(row.cases_json) as SkillEvalCaseResult[], model: row.model, error: row.error, createdAt: row.created_at, completedAt: row.completed_at }; }
function bindRun(run: SkillEvalRun) { return { $id: run.id, $skillId: run.skillId, $status: run.status, $model: run.model, $createdAt: run.createdAt }; }
function aggregateScore(cases: readonly SkillEvalCaseResult[]): number | null { const scores = cases.flatMap((item) => item.score === null ? [] : [item.score]); return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null; }
