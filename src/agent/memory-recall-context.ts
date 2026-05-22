import type { AssistantToolCallMessage, BotSession } from "../session/types";
import type { ChannelMessage } from "../channel/types";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { SqliteEpisodeStore } from "../episodes/episode-store";
import type { SessionManager } from "../session/session-manager";
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
  sessions: SessionManager;
  source: "preload" | "recall";
  limit: number;
}): Promise<AgentRecallResult> {
  const excludeMemoryIds = input.alreadyLoadedIds
    .flatMap((id) => id.startsWith("episode:") ? [] : [id.startsWith("memory:") ? id.slice("memory:".length) : id]);
  const excludeEpisodeIds = input.alreadyLoadedIds
    .flatMap((id) => id.startsWith("episode:") ? [id.slice("episode:".length)] : []);
  const result = await unifiedMemoryRecall({
    memory: input.memoryStore,
    episodes: input.episodeStore,
    queries: input.searches,
    excludeMemoryIds,
    excludeEpisodeIds,
    limit: input.limit,
    source: input.source,
  });
  const memories = await Promise.all(result.hits.map((hit) => recallMemoryResult(input.sessions, hit)));
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
  return memories.map((memory) => `ID: \`${memory.id}\`\n${memory.content}`).join("\n\n");
}

async function recallMemoryResult(
  sessions: SessionManager,
  hit: UnifiedRecallHit,
): Promise<{ id: string; content: string }> {
  if (hit.source === "memory") {
    return { id: `memory:${hit.id}`, content: formatMemoryForRecall(hit.memory) };
  }
  return {
    id: `episode:${hit.id}`,
    content: await formatEpisodeForRecallWithEvidence(sessions, hit.episode),
  };
}
