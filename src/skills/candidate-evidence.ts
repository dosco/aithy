import { Database } from "bun:sqlite";
import type { SkillCandidateEntry } from "./candidate-store";

interface EvidenceRow {
  id: number;
  role: string;
  message_kind: string | null;
  content: string | null;
  tool_name: string | null;
  tool_args: string | null;
  tool_result: string | null;
  created_at: string;
}

export function loadCandidateEvidence(dbPath: string, candidate: SkillCandidateEntry): string {
  const db = new Database(dbPath, { readonly: true });
  db.exec("PRAGMA busy_timeout = 10000;");
  try {
    const rows = db
      .query(
        `SELECT id, role, message_kind, content, tool_name, tool_args, tool_result, created_at
         FROM messages
         WHERE session_id = $sessionId
           AND id >= $start
           AND id <= $end
         ORDER BY id ASC`,
      )
      .all({
        $sessionId: candidate.sourceSessionId,
        $start: Math.min(candidate.evidenceStartMessageId, candidate.evidenceEndMessageId),
        $end: Math.max(candidate.evidenceStartMessageId, candidate.evidenceEndMessageId),
      }) as EvidenceRow[];
    return rows.length > 0
      ? rows.map(formatEvidenceRow).join("\n")
      : `No transcript rows found. Candidate summary: ${candidate.canonicalText}`;
  } finally {
    db.close();
  }
}

function formatEvidenceRow(row: EvidenceRow): string {
  if (row.tool_name) {
    return [
      `[#${row.id} ${row.created_at}] tool ${row.tool_name}`,
      `args: ${compactJson(row.tool_args)}`,
      `result: ${compactJson(row.tool_result)}`,
    ].join("\n");
  }
  return `[#${row.id} ${row.created_at}] ${row.role}: ${compact(row.content ?? "")}`;
}

function compactJson(raw: string | null): string {
  if (!raw) return "null";
  try {
    return compact(JSON.stringify(JSON.parse(raw)));
  } catch {
    return compact(raw);
  }
}

function compact(text: string, max = 2_000): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)} [truncated]` : cleaned;
}
