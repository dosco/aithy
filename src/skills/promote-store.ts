import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations, type SqliteMigration } from "../sqlite/migrations";

export type SkillPromotionStatus = "pending" | "accepted" | "dismissed";

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  body: string;
  allowedTools: string | null;
  tags: string | null;
}

export interface SkillPromotionEntry {
  signature: string;
  status: SkillPromotionStatus;
  subSessionId: string;
  sourceSessionId: string;
  sourceMessageId: number | null;
  toolName: string;
  argsPreview: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  draft: SkillDraft;
  savedSkillId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillPromotionCreate {
  signature: string;
  subSessionId: string;
  sourceSessionId: string;
  sourceMessageId?: number | null;
  toolName: string;
  argsPreview: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  draft: SkillDraft;
}

interface SkillPromotionRow {
  signature: string;
  status: SkillPromotionStatus;
  sub_session_id: string;
  source_session_id: string;
  source_message_id: number | null;
  tool_name: string;
  args_preview: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  draft_id: string;
  draft_name: string;
  draft_description: string;
  draft_body: string;
  draft_allowed_tools: string | null;
  draft_tags: string | null;
  saved_skill_id: string | null;
  created_at: string;
  updated_at: string;
}

const skillPromoteMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE skill_promotions (
        signature TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'dismissed')),
        sub_session_id TEXT NOT NULL UNIQUE,
        source_session_id TEXT NOT NULL,
        source_message_id INTEGER,
        tool_name TEXT NOT NULL,
        args_preview TEXT NOT NULL,
        count INTEGER NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        draft_name TEXT NOT NULL,
        draft_description TEXT NOT NULL,
        draft_body TEXT NOT NULL,
        draft_allowed_tools TEXT,
        draft_tags TEXT,
        saved_skill_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX skill_promotions_sub_session_idx ON skill_promotions(sub_session_id);
      CREATE INDEX skill_promotions_status_idx ON skill_promotions(status, updated_at DESC);
    `,
  },
];

export class SqliteSkillPromotionStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    applySqliteMigrations(this.db, "skill_promote", skillPromoteMigrations);
  }

  createPending(input: SkillPromotionCreate): SkillPromotionEntry {
    const now = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO skill_promotions (
          signature, status, sub_session_id, source_session_id, source_message_id,
          tool_name, args_preview, count, first_seen_at, last_seen_at,
          draft_id, draft_name, draft_description, draft_body, draft_allowed_tools,
          draft_tags, created_at, updated_at
        )
        VALUES (
          $signature, 'pending', $subSessionId, $sourceSessionId, $sourceMessageId,
          $toolName, $argsPreview, $count, $firstSeenAt, $lastSeenAt,
          $draftId, $draftName, $draftDescription, $draftBody, $draftAllowedTools,
          $draftTags, $now, $now
        )`,
      )
      .run({
        $signature: input.signature,
        $subSessionId: input.subSessionId,
        $sourceSessionId: input.sourceSessionId,
        $sourceMessageId: input.sourceMessageId ?? null,
        $toolName: input.toolName,
        $argsPreview: input.argsPreview,
        $count: input.count,
        $firstSeenAt: input.firstSeenAt,
        $lastSeenAt: input.lastSeenAt,
        $draftId: input.draft.id,
        $draftName: input.draft.name,
        $draftDescription: input.draft.description,
        $draftBody: input.draft.body,
        $draftAllowedTools: input.draft.allowedTools,
        $draftTags: input.draft.tags,
        $now: now,
      });
    return this.get(input.signature)!;
  }

  hasSignature(signature: string): boolean {
    const row = this.db
      .query("SELECT 1 FROM skill_promotions WHERE signature = $signature")
      .get({ $signature: signature });
    return Boolean(row);
  }

  get(signature: string): SkillPromotionEntry | null {
    const row = this.db
      .query("SELECT * FROM skill_promotions WHERE signature = $signature")
      .get({ $signature: signature }) as SkillPromotionRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  pendingBySubSession(subSessionId: string): SkillPromotionEntry | null {
    const row = this.db
      .query(
        `SELECT * FROM skill_promotions
         WHERE sub_session_id = $subSessionId AND status = 'pending'`,
      )
      .get({ $subSessionId: subSessionId }) as SkillPromotionRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  markAccepted(signature: string, savedSkillId: string): SkillPromotionEntry | null {
    this.db
      .query(
        `UPDATE skill_promotions
         SET status = 'accepted',
             saved_skill_id = $savedSkillId,
             updated_at = $updatedAt
         WHERE signature = $signature AND status = 'pending'`,
      )
      .run({
        $signature: signature,
        $savedSkillId: savedSkillId,
        $updatedAt: new Date().toISOString(),
      });
    return this.get(signature);
  }

  markDismissed(signature: string): SkillPromotionEntry | null {
    this.db
      .query(
        `UPDATE skill_promotions
         SET status = 'dismissed',
             updated_at = $updatedAt
         WHERE signature = $signature AND status = 'pending'`,
      )
      .run({
        $signature: signature,
        $updatedAt: new Date().toISOString(),
      });
    return this.get(signature);
  }

  close(): void {
    this.db.close();
  }
}

function rowToEntry(row: SkillPromotionRow): SkillPromotionEntry {
  return {
    signature: row.signature,
    status: row.status,
    subSessionId: row.sub_session_id,
    sourceSessionId: row.source_session_id,
    sourceMessageId: row.source_message_id,
    toolName: row.tool_name,
    argsPreview: row.args_preview,
    count: row.count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    draft: {
      id: row.draft_id,
      name: row.draft_name,
      description: row.draft_description,
      body: row.draft_body,
      allowedTools: row.draft_allowed_tools,
      tags: row.draft_tags,
    },
    savedSkillId: row.saved_skill_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
