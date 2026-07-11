import type { Database } from "bun:sqlite";
import type { SkillRow } from "../session/sqlite-session-schema";
import {
  eventRowToEntry,
  fileRowToEntry,
  shiftHeadingsToAtLeastH4,
  type SkillEventRow,
  type SkillFileRow,
} from "./skills-store-helpers";
import type { SkillEntry, SkillUsageEvent } from "./types";
import { parseSkillEvalsJson } from "./evals";

export function skillEntryFromRow(db: Database, row: SkillRow): SkillEntry {
  return {
    evals: parseSkillEvalsJson(row.evals_json),
    id: row.id,
    name: row.name,
    description: row.description,
    when_to_use: row.when_to_use,
    allowed_tools: row.allowed_tools,
    required_sandbox_capabilities: row.required_sandbox_capabilities,
    tags: row.tags,
    body: shiftHeadingsToAtLeastH4(row.content),
    files: skillFiles(db, row.id),
    links: skillLinks(db, row.id),
    recent_usage: skillRecentUsage(db, row.id),
    retrieved_count: row.retrieved_count,
    used_count: row.used_count,
    disable_model_invocation: Boolean(row.disable_model_invocation),
    user_invocable: Boolean(row.user_invocable),
    source_kind: row.source_kind ?? "user",
    source_id: row.source_id,
    source_version: row.source_version,
    source_hash: row.source_hash,
    disabled_at: row.disabled_at,
    duplicated_from_source_id: row.duplicated_from_source_id,
    last_retrieved_at: row.last_retrieved_at,
    last_used_at: row.last_used_at,
    updated_at: row.updated_at,
  };
}

export function skillRecentUsage(db: Database, skillId: string, limit = 5): SkillUsageEvent[] {
  const rows = db
    .query(
      `SELECT *
       FROM skill_events
       WHERE skill_id = $skillId AND event_type = 'used'
       ORDER BY id DESC
       LIMIT $limit`,
    )
    .all({ $skillId: skillId, $limit: Math.max(1, limit) }) as SkillEventRow[];
  return rows.map(eventRowToEntry);
}

function skillFiles(db: Database, skillId: string): SkillEntry["files"] {
  const rows = db
    .query("SELECT path, content, content_hash, bytes, updated_at FROM skill_files WHERE skill_id = $id ORDER BY path")
    .all({ $id: skillId }) as SkillFileRow[];
  return rows.map(fileRowToEntry);
}

function skillLinks(db: Database, skillId: string): string[] {
  const rows = db
    .query("SELECT target_skill_id FROM skill_links WHERE skill_id = $id ORDER BY target_skill_id")
    .all({ $id: skillId }) as Array<{ target_skill_id: string }>;
  return rows.map((row) => row.target_skill_id);
}
