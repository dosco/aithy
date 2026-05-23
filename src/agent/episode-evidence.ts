import { formatEpisodeForRecall } from "../episodes/format";
import type { AgentEpisodeEntry } from "../episodes/types";
import type { SessionManager } from "../session/session-manager";
import type { BotMessage } from "../session/types";

export async function formatEpisodeForRecallWithEvidence(
  sessions: SessionManager,
  episode: AgentEpisodeEntry,
  options: { includeEvidence?: boolean; maxEvidenceChars?: number } = {},
): Promise<string> {
  // Evidence-first recall, following arXiv:2605.12978: keep the dream summary
  // useful, but ground it in the original transcript when that evidence exists.
  return formatEpisodeForRecall(
    episode,
    options.includeEvidence === false ? undefined : await episodeEvidenceExcerpt(sessions, episode, options.maxEvidenceChars ?? 6_000),
  );
}

async function episodeEvidenceExcerpt(
  sessions: SessionManager,
  episode: AgentEpisodeEntry,
  maxChars: number,
): Promise<string | undefined> {
  try {
    const messages = await sessions.messagesByIdRange(
      episode.sourceSessionId,
      episode.evidenceStartMessageId,
      episode.evidenceEndMessageId,
      { limit: 12, maxChars },
    );
    const excerpt = formatRawTranscriptExcerpt(messages, maxChars);
    return excerpt || undefined;
  } catch {
    return undefined;
  }
}

function formatRawTranscriptExcerpt(
  messages: ReadonlyArray<{ id: number; message: BotMessage }>,
  maxChars: number,
): string {
  const lines: string[] = [];
  let total = 0;
  for (const item of messages) {
    const line = compactTranscriptLine(item.id, item.message);
    const available = maxChars - total;
    if (available <= 0) break;
    if (line.length + 1 > available) {
      if (available > 24) lines.push(`${line.slice(0, available - 13)} [truncated]`);
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join("\n");
}

function compactTranscriptLine(id: number, message: BotMessage): string {
  const prefix = `#${id}`;
  if (message.role === "user") return `${prefix} user: ${compactEvidenceText(message.content)}`;
  if (message.kind === "text") return `${prefix} assistant: ${compactEvidenceText(message.content)}`;
  if (message.kind === "tool_call") {
    return `${prefix} tool ${message.toolName}: args=${compactEvidenceJson(message.toolArgs)} result=${compactEvidenceJson(message.toolResult)}`;
  }
  if (message.kind === "artifact") {
    return `${prefix} artifact ${message.title}: ${compactEvidenceText(message.sandboxPath)}`;
  }
  return `${prefix} permission ${message.toolName}: ${message.status}`;
}

function compactEvidenceText(text: string, maxChars = 1_500): string {
  const compacted = text.replace(/\s+/g, " ").trim();
  return compacted.length > maxChars ? `${compacted.slice(0, maxChars - 12)} [truncated]` : compacted;
}

function compactEvidenceJson(value: unknown): string {
  try {
    return compactEvidenceText(JSON.stringify(value ?? null));
  } catch {
    return "[unserializable]";
  }
}
