import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations, type SqliteMigration } from "../sqlite/migrations";

export type SkillCandidateStatus = "developing" | "suggested" | "accepted" | "dismissed";

export interface SkillCandidateEntry {
  id: string;
  status: SkillCandidateStatus;
  dedupeKey: string;
  title: string;
  description: string;
  canonicalText: string;
  rationale: string;
  confidence: number;
  tags: string | null;
  sourceSessionId: string;
  evidenceStartMessageId: number;
  evidenceEndMessageId: number;
  seenCount: number;
  subSessionId: string | null;
  savedSkillId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillCandidateUpsert {
  existingId?: string | null;
  title: string;
  description: string;
  canonicalText: string;
  rationale: string;
  confidence: number;
  tags?: string | null;
  sourceSessionId: string;
  evidenceStartMessageId: number;
  evidenceEndMessageId: number;
}

interface SkillCandidateRow {
  id: string;
  status: SkillCandidateStatus;
  dedupe_key: string;
  title: string;
  description: string;
  canonical_text: string;
  rationale: string;
  confidence: number;
  tags: string | null;
  source_session_id: string;
  evidence_start_message_id: number;
  evidence_end_message_id: number;
  seen_count: number;
  sub_session_id: string | null;
  saved_skill_id: string | null;
  created_at: string;
  updated_at: string;
}

const migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE skill_candidate_state (
        key TEXT PRIMARY KEY CHECK (key = 'cursor'),
        last_message_id INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      INSERT INTO skill_candidate_state(key, last_message_id, updated_at)
      VALUES ('cursor', 0, datetime('now'));

      CREATE TABLE skill_candidates (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('developing', 'suggested', 'accepted', 'dismissed')),
        dedupe_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        canonical_text TEXT NOT NULL,
        rationale TEXT NOT NULL,
        confidence REAL NOT NULL,
        tags TEXT,
        source_session_id TEXT NOT NULL,
        evidence_start_message_id INTEGER NOT NULL,
        evidence_end_message_id INTEGER NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        sub_session_id TEXT UNIQUE,
        saved_skill_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX skill_candidates_status_idx ON skill_candidates(status, updated_at DESC);
      CREATE INDEX skill_candidates_session_idx ON skill_candidates(source_session_id, status, updated_at DESC);
      CREATE INDEX skill_candidates_sub_session_idx ON skill_candidates(sub_session_id);
    `,
  },
  {
    version: 2,
    precondition: hasLegacyPromotions,
    sql: `
      INSERT OR IGNORE INTO skill_candidates (
        id, status, dedupe_key, title, description, canonical_text, rationale,
        confidence, tags, source_session_id, evidence_start_message_id,
        evidence_end_message_id, seen_count, sub_session_id, saved_skill_id,
        created_at, updated_at
      )
      SELECT
        'legacy-' || substr(lower(hex(randomblob(16))), 1, 16),
        CASE status WHEN 'pending' THEN 'suggested' ELSE status END,
        'legacy:' || signature,
        COALESCE(NULLIF(draft_name, ''), args_preview),
        COALESCE(NULLIF(draft_description, ''), 'Repeated workflow: ' || args_preview),
        args_preview,
        'Migrated from legacy skill promotion.',
        1.0,
        draft_tags,
        source_session_id,
        COALESCE(source_message_id, 0),
        COALESCE(source_message_id, 0),
        count,
        sub_session_id,
        saved_skill_id,
        created_at,
        updated_at
      FROM skill_promotions;
    `,
  },
];

export class SqliteSkillCandidateStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "skill_candidates", migrations);
  }

  cursor(): number {
    const row = this.db
      .query("SELECT last_message_id FROM skill_candidate_state WHERE key = 'cursor'")
      .get() as { last_message_id: number } | undefined;
    return row?.last_message_id ?? 0;
  }

  setCursor(messageId: number): void {
    const now = new Date().toISOString();
    this.db
      .query(
        `UPDATE skill_candidate_state
         SET last_message_id = MAX(last_message_id, $messageId), updated_at = $now
         WHERE key = 'cursor'`,
      )
      .run({ $messageId: Math.max(0, Math.floor(messageId)), $now: now });
  }

  upsertCandidate(input: SkillCandidateUpsert): SkillCandidateEntry {
    const now = new Date().toISOString();
    const existing = input.existingId ? this.get(input.existingId) : this.getByDedupe(normalizeDedupeKey(input.canonicalText));
    if (existing) {
      this.db
        .query(
          `UPDATE skill_candidates
           SET title = $title,
               description = $description,
               canonical_text = $canonicalText,
               rationale = $rationale,
               confidence = $confidence,
               tags = $tags,
               evidence_start_message_id = MIN(evidence_start_message_id, $evidenceStartMessageId),
               evidence_end_message_id = MAX(evidence_end_message_id, $evidenceEndMessageId),
               seen_count = seen_count + 1,
               updated_at = $updatedAt
           WHERE id = $id`,
        )
        .run(bindUpsert({ ...input, id: existing.id, updatedAt: now }));
      return this.get(existing.id)!;
    }

    const id = candidateId(input.title, input.canonicalText);
    this.db
      .query(
        `INSERT INTO skill_candidates (
          id, status, dedupe_key, title, description, canonical_text, rationale,
          confidence, tags, source_session_id, evidence_start_message_id,
          evidence_end_message_id, seen_count, created_at, updated_at
        )
        VALUES (
          $id, 'developing', $dedupeKey, $title, $description, $canonicalText,
          $rationale, $confidence, $tags, $sourceSessionId, $evidenceStartMessageId,
          $evidenceEndMessageId, 1, $updatedAt, $updatedAt
        )`,
      )
      .run({
        ...bindUpsert({ ...input, id, updatedAt: now }),
        $dedupeKey: normalizeDedupeKey(input.canonicalText),
      });
    return this.get(id)!;
  }

  get(id: string): SkillCandidateEntry | null {
    const row = this.db.query("SELECT * FROM skill_candidates WHERE id = $id").get({ $id: id }) as
      | SkillCandidateRow
      | undefined;
    return row ? rowToEntry(row) : null;
  }

  pendingBySubSession(subSessionId: string): SkillCandidateEntry | null {
    const row = this.db
      .query("SELECT * FROM skill_candidates WHERE sub_session_id = $subSessionId AND status = 'suggested'")
      .get({ $subSessionId: subSessionId }) as SkillCandidateRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  openBySession(sessionId: string, limit = 5): SkillCandidateEntry[] {
    const rows = this.db
      .query(
        `SELECT * FROM skill_candidates
         WHERE source_session_id = $sessionId AND status = 'developing'
         ORDER BY updated_at DESC
         LIMIT $limit`,
      )
      .all({ $sessionId: sessionId, $limit: Math.max(1, limit) }) as SkillCandidateRow[];
    return rows.map(rowToEntry);
  }

  markSuggested(id: string, subSessionId: string): SkillCandidateEntry | null {
    this.db
      .query(
        `UPDATE skill_candidates
         SET status = 'suggested',
             sub_session_id = $subSessionId,
             updated_at = $updatedAt
         WHERE id = $id AND status = 'developing'`,
      )
      .run({ $id: id, $subSessionId: subSessionId, $updatedAt: new Date().toISOString() });
    return this.get(id);
  }

  markAccepted(id: string, savedSkillId: string): SkillCandidateEntry | null {
    this.db
      .query(
        `UPDATE skill_candidates
         SET status = 'accepted',
             saved_skill_id = $savedSkillId,
             updated_at = $updatedAt
         WHERE id = $id AND status = 'suggested'`,
      )
      .run({ $id: id, $savedSkillId: savedSkillId, $updatedAt: new Date().toISOString() });
    return this.get(id);
  }

  markDismissed(id: string): SkillCandidateEntry | null {
    this.db
      .query(
        `UPDATE skill_candidates
         SET status = 'dismissed',
             updated_at = $updatedAt
         WHERE id = $id AND status = 'suggested'`,
      )
      .run({ $id: id, $updatedAt: new Date().toISOString() });
    return this.get(id);
  }

  close(): void {
    this.db.close();
  }

  private getByDedupe(dedupeKey: string): SkillCandidateEntry | null {
    const row = this.db.query("SELECT * FROM skill_candidates WHERE dedupe_key = $dedupeKey").get({
      $dedupeKey: dedupeKey,
    }) as SkillCandidateRow | undefined;
    return row ? rowToEntry(row) : null;
  }
}

export function normalizeDedupeKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function candidateId(title: string, canonicalText: string): string {
  const slug = (title || canonicalText)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill-candidate";
  const hash = createHash("sha256").update(canonicalText || title).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

function bindUpsert(input: SkillCandidateUpsert & { id: string; updatedAt: string }) {
  return {
    $id: input.id,
    $title: clean(input.title, 160),
    $description: clean(input.description, 2_000),
    $canonicalText: clean(input.canonicalText, 4_000),
    $rationale: clean(input.rationale, 2_000),
    $confidence: clampConfidence(input.confidence),
    $tags: cleanOptional(input.tags, 500),
    $sourceSessionId: input.sourceSessionId,
    $evidenceStartMessageId: Math.max(0, Math.floor(input.evidenceStartMessageId)),
    $evidenceEndMessageId: Math.max(0, Math.floor(input.evidenceEndMessageId)),
    $updatedAt: input.updatedAt,
  };
}

function rowToEntry(row: SkillCandidateRow): SkillCandidateEntry {
  return {
    id: row.id,
    status: row.status,
    dedupeKey: row.dedupe_key,
    title: row.title,
    description: row.description,
    canonicalText: row.canonical_text,
    rationale: row.rationale,
    confidence: row.confidence,
    tags: row.tags,
    sourceSessionId: row.source_session_id,
    evidenceStartMessageId: row.evidence_start_message_id,
    evidenceEndMessageId: row.evidence_end_message_id,
    seenCount: row.seen_count,
    subSessionId: row.sub_session_id,
    savedSkillId: row.saved_skill_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clean(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function cleanOptional(value: string | null | undefined, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function hasLegacyPromotions(db: Database): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'skill_promotions'")
    .get();
  return Boolean(row);
}
