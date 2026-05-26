import type { AssistantToolCallMessage, BotSession } from "../session/types";
import type { ChannelMessage } from "../channel/types";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { SqliteEpisodeStore } from "../episodes/episode-store";
import type { SessionManager } from "../session/session-manager";
import type { SqliteTranscriptRecallStore } from "../retrieval/transcript-recall";
import { formatMemoryForRecall } from "../memory/format";
import { unifiedMemoryRecall, type UnifiedRecallHit } from "../retrieval/memory-recall";
import { compactPreview } from "./run-message-helpers";
import { formatEpisodeForRecallWithEvidence } from "./episode-evidence";

export interface AgentRecallResult {
  memories: Array<{ id: string; content: string }>;
  hitIds: string[];
  toolMessage: AssistantToolCallMessage;
}

export async function recallForAgent(input: {
  searches: readonly string[];
  alreadyLoadedIds: readonly string[];
  memoryStore?: SqliteMemoryStore;
  episodeStore?: SqliteEpisodeStore;
  transcriptStore?: SqliteTranscriptRecallStore;
  sessions: SessionManager;
  workspaceRoot?: string;
  conversationId?: string;
  source: "preload" | "recall";
  limit: number;
  beforeCreatedAt?: string;
}): Promise<AgentRecallResult> {
  const excludeMemoryIds = input.alreadyLoadedIds
    .flatMap((id) => id.startsWith("episode:") ? [] : [id.startsWith("memory:") ? id.slice("memory:".length) : id]);
  const excludeEpisodeIds = input.alreadyLoadedIds
    .flatMap((id) => id.startsWith("episode:") ? [id.slice("episode:".length)] : []);
  const excludeTranscriptIds = input.alreadyLoadedIds
    .flatMap((id) => id.startsWith("transcript:") ? [id.slice("transcript:".length)] : []);
  const result = await unifiedMemoryRecall({
    memory: input.memoryStore,
    episodes: input.episodeStore,
    transcripts: input.transcriptStore,
    queries: input.searches,
    excludeMemoryIds,
    excludeEpisodeIds,
    excludeTranscriptIds,
    beforeCreatedAt: input.beforeCreatedAt,
    limit: input.limit,
    source: input.source,
    memorySearchOptions: {
      scope: {
        includeGlobal: true,
        workspaceRef: input.workspaceRoot,
        sessionRef: input.conversationId,
      },
    },
  });
  const memories = budgetFormattedMemories(
    await Promise.all(result.hits.map((hit) => recallMemoryResult(input.sessions, hit, input.source))),
    input.source === "preload" ? 1_800 : 4_000,
  );
  return {
    memories,
    hitIds: memories.map((memory) => memory.id),
    toolMessage: {
      role: "assistant",
      kind: "tool_call",
      toolName: "memory.recall",
      toolArgs: {
        source: input.source,
        queries: [...input.searches],
        excludeIds: [...input.alreadyLoadedIds],
      },
      toolResult: {
        diagnostics: result.diagnostics,
        matches: memories.map((memory) => ({
          id: memory.id,
          contentBytes: memory.content.length,
          contentPreview: compactPreview(memory.content),
        })),
      },
      createdAt: new Date().toISOString(),
    },
  };
}

export function preRecallQueries(session: BotSession, message: ChannelMessage): string[] {
  const latest = message.text.trim();
  const previous = [...session.messages]
    .reverse()
    .filter((item) => item.role === "user")
    .slice(0, 2)
    .map((item) => item.content.trim())
    .filter(Boolean)
    .join("\n");
  return [latest, previous].filter((query, index, all) => query && all.indexOf(query) === index);
}

export function memoryContextText(memories: readonly { id: string; content: string }[]): string | undefined {
  if (memories.length === 0) return undefined;
  return memories.map((memory) => memory.content).join("\n\n");
}

async function recallMemoryResult(
  sessions: SessionManager,
  hit: UnifiedRecallHit,
  source: "preload" | "recall",
): Promise<{ id: string; content: string }> {
  if (hit.source === "memory") {
    return { id: `memory:${hit.id}`, content: formatMemoryForRecall(hit.memory) };
  }
  if (hit.source === "transcript") {
    return { id: `transcript:${hit.id}`, content: hit.transcript.content };
  }
  return {
    id: `episode:${hit.id}`,
    content: await formatEpisodeForRecallWithEvidence(sessions, hit.episode, {
      includeEvidence: hit.rank.exactAnchor || source === "recall",
      maxEvidenceChars: source === "preload" ? 1_000 : 2_000,
    }),
  };
}

function budgetFormattedMemories(
  memories: Array<{ id: string; content: string }>,
  maxChars: number,
): Array<{ id: string; content: string }> {
  const selected: Array<{ id: string; content: string }> = [];
  let used = 0;
  for (const memory of memories) {
    const separator = selected.length > 0 ? 2 : 0;
    const remaining = maxChars - used - separator;
    if (remaining <= 0) break;
    if (memory.content.length <= remaining) {
      selected.push(memory);
      used += memory.content.length + separator;
      continue;
    }
    if (remaining >= 400) {
      selected.push({ ...memory, content: `${memory.content.slice(0, remaining - 13)} [truncated]` });
      break;
    }
  }
  return selected;
}
