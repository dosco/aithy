import {
  AxAIServiceAbortedError,
  type AxAgentSkillResult,
  type AxAgentSkillsSearchFn,
  type AxAgentUsedSkill,
} from "@ax-llm/ax";
import type { ActiveRunRegistry } from "./active-runs";
import type { StoppableProgram } from "./active-runs";
import type { ChannelMessage, ChannelReply } from "../channel/types";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { SqliteEpisodeStore } from "../episodes/episode-store";
import type { SqliteArtifactStore } from "../artifacts/artifact-store";
import type { MemoryQueue } from "../memory/memory-queue";
import type { NotificationCreate } from "../notifications/types";
import { formatMemoryForRecall } from "../memory/format";
import type { SqliteUsageStore } from "../usage/usage-store";
import type { SqliteSkillsStore } from "../skills/skills-store";
import { captureProgramUsage } from "../usage/capture";
import type { SandboxProvider } from "../sandbox/provider";
import type { SessionManager } from "../session/session-manager";
import type { UserProfile } from "../profile/types";
import { userProfileForAgent } from "../profile/service";
import type { SoulProfile } from "../soul/types";
import type { AssistantToolCallMessage } from "../session/types";
import { isClarificationPause } from "./clarification";
import { userFacingErrorText } from "./error-copy";
import {
  artifactContextText,
  artifactIdsForRun,
  artifactMessagesForTurn,
  createArtifactRunContext,
} from "./artifact-turn";
import { artifactRepairRequest, shouldRequireArtifactForRequest } from "./artifact-intent";
import { createAithyAgent, type AxAgentMemoriesSearchFn } from "./create-agent";
import {
  assistantTextMessage,
  compactPreview,
  conversationHistoryForAgent,
  safeGetChatLog,
  toChannelContext,
  toolCallMessage,
  turnMessages,
  wrapSkillsSearch,
} from "./run-message-helpers";
import type { ToolContext } from "./tool-context";
import { createAgentTools } from "./tools";
import type { CapabilityBroker } from "../security/capability-broker";
import type { RuntimeStore } from "../runtime/runtime-store";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { AutomationToolActions } from "../automations/tool-actions";
import { appendChatLogToTraces } from "./trace-writer";
import {
  prefetchUrlsForMessage,
  type UrlPrefetcher,
  type UrlPrefetchOutput,
} from "./url-prefetch";
import {
  prefetchSearchForMessage,
  type SearchPrefetcher,
  type SearchPrefetchOutput,
} from "./search-prefetch";
import { formatEpisodeForRecallWithEvidence } from "./episode-evidence";

export interface RunMessageDeps {
  config: AppConfig;
  events: EventBus;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  soul?: SoulProfile;
  profile?: UserProfile;
  memory?: SqliteMemoryStore;
  episodes?: SqliteEpisodeStore;
  artifacts?: SqliteArtifactStore;
  memoryQueue?: MemoryQueue;
  usage?: SqliteUsageStore;
  skillsSearch?: AxAgentSkillsSearchFn;
  skills?: readonly AxAgentSkillResult[];
  skillsStore?: SqliteSkillsStore;
  loadedSkillIds?: Set<string>;
  onLoadedSkills?: (results: readonly AxAgentSkillResult[]) => void | Promise<void>;
  onUsedSkills?: (usedSkills: readonly AxAgentUsedSkill[]) => void | Promise<void>;
  agentFactory?: typeof createAithyAgent;
  activeRuns?: ActiveRunRegistry;
  notify?: (input: NotificationCreate) => void;
  userMessagePersisted?: boolean;
  capabilities?: CapabilityBroker;
  runtimeStore?: RuntimeStore;
  tasks?: SqliteTaskStore;
  automations?: AutomationToolActions;
  taskId?: string;
  flushSessionState?: () => Promise<void>;
  urlPrefetcher?: UrlPrefetcher;
  searchPrefetcher?: SearchPrefetcher;
}

export async function runMessage(
  message: ChannelMessage,
  deps: RunMessageDeps,
): Promise<ChannelReply> {
  deps.events.emit({
    type: "message.received",
    conversationId: message.conversationId,
    text: message.text,
  });

  const session = await deps.sessions.get(message.conversationId);
  const artifactRun = createArtifactRunContext(message.conversationId);
  const artifactIdsBeforeTurn = artifactIdsForRun(deps.artifacts, message.conversationId, artifactRun.runId);
  const memoryQueue = deps.memoryQueue;
  const toolContext: ToolContext = {
    session,
    sandbox: deps.sandbox,
    sessions: deps.sessions,
    workspacePath: deps.config.workspaceRoot,
    events: deps.events,
    memory: deps.memory,
    skills: deps.skillsStore,
    loadedSkillIds: deps.loadedSkillIds,
    enqueueRemember: memoryQueue
      ? (req) => memoryQueue.enqueueExplicit(req.sessionId, req.hint)
      : undefined,
    artifacts: deps.artifacts,
    artifactRunId: artifactRun.runId,
    artifactRunOutboxPath: artifactRun.runOutboxPath,
    notify: deps.notify,
    capabilities: deps.capabilities,
    runtimeStore: deps.runtimeStore,
    tasks: deps.tasks,
    automations: deps.automations,
    taskId: deps.taskId,
    flushSessionState: deps.flushSessionState,
  };
  const toolCallMessages: AssistantToolCallMessage[] = [];
  const agentFactory = deps.agentFactory ?? createAithyAgent;
  const publishToolCall = (toolMessage: AssistantToolCallMessage) => {
    deps.events.emit({
      type: "agent.tool_call",
      conversationId: message.conversationId,
      message: toolMessage,
    });
  };
  const recordToolCall = (toolMessage: AssistantToolCallMessage) => {
    toolCallMessages.push(toolMessage);
    publishToolCall(toolMessage);
  };
  const onSkillsSearch = wrapSkillsSearch(deps.skillsSearch, toolCallMessages, publishToolCall);
  const memoryStore = deps.memory;
  const episodeStore = deps.episodes;
  const onMemoriesSearch: AxAgentMemoriesSearchFn | undefined = memoryStore || episodeStore
    ? async (searches, alreadyLoaded) => {
      const excludeMemoryIds = alreadyLoaded
        .map((m) => m.id)
        .flatMap((id) => id.startsWith("memory:") ? [id.slice("memory:".length)] : id.startsWith("episode:") ? [] : [id]);
      const excludeEpisodeIds = alreadyLoaded
        .map((m) => m.id)
        .flatMap((id) => id.startsWith("episode:") ? [id.slice("episode:".length)] : []);
      const [memoryHits, episodeHits] = await Promise.all([
        memoryStore
          ? memoryStore.search([...searches], {
              limit: 5,
              excludeIds: excludeMemoryIds,
            })
          : [],
        episodeStore
          ? episodeStore.search([...searches], {
              limit: 3,
              excludeIds: excludeEpisodeIds,
            })
          : [],
      ]);
      const episodeResults = await Promise.all(episodeHits.map(async (episode) => ({
        id: `episode:${episode.id}`,
        content: await formatEpisodeForRecallWithEvidence(deps.sessions, episode),
      })));
      const results = [
        ...memoryHits.map((m) => ({
          id: `memory:${m.id}`,
          content: formatMemoryForRecall(m),
        })),
        ...episodeResults,
      ];
      const toolMessage: AssistantToolCallMessage = {
        role: "assistant",
        kind: "tool_call",
        toolName: "memory.recall",
        toolArgs: {
          queries: [...searches],
          excludeIds: alreadyLoaded.map((m) => m.id),
        },
        toolResult: {
          matches: results.map((m) => ({
            id: m.id,
            contentBytes: m.content.length,
            contentPreview: compactPreview(m.content),
          })),
        },
        createdAt: new Date().toISOString(),
      };
      toolCallMessages.push(toolMessage);
      publishToolCall(toolMessage);
      return results;
    }
    : undefined;
  const { program, llm } = agentFactory({
    config: deps.config,
    tools: createAgentTools(toolContext, deps.config),
    events: deps.events,
    conversationId: message.conversationId,
    soul: deps.soul,
    onSkillsSearch,
    onLoadedSkills: deps.onLoadedSkills,
    onUsedSkills: deps.onUsedSkills,
    onMemoriesSearch,
    onFunctionCall: (call) => {
      if (!shouldRecordFunctionCall(call)) return;
      const toolMessage = toolCallMessage(call);
      toolCallMessages.push(toolMessage);
      publishToolCall(toolMessage);
    },
  });

  if (program.stop) deps.activeRuns?.register(message.conversationId, program as StoppableProgram);
  deps.events.emit({
    type: "agent.started",
    conversationId: message.conversationId,
    provider: deps.config.aiProvider,
    model: deps.config.aiModel ?? "provider default",
  });

  let urlPrefetch: UrlPrefetchOutput | undefined;
  let searchPrefetch: SearchPrefetchOutput | undefined;
  try {
    const urlPrefetcher = deps.urlPrefetcher ?? prefetchUrlsForMessage;
    urlPrefetch = await urlPrefetcher({
      message,
      config: deps.config,
      toolContext,
      onToolCall: recordToolCall,
    });
    if (!urlPrefetch?.context) {
      const searchPrefetcher = deps.searchPrefetcher ?? prefetchSearchForMessage;
      searchPrefetch = await searchPrefetcher({
        message,
        config: deps.config,
        toolContext,
        onToolCall: recordToolCall,
      });
    }
    const userProfile = userProfileForAgent(deps.profile);
    const input = {
      ...(userProfile ? { userProfile } : {}),
      userRequest: message.text,
      ...(urlPrefetch?.context ? { urlContext: urlPrefetch.context } : {}),
      ...(searchPrefetch?.context ? { searchContext: searchPrefetch.context } : {}),
      artifactContext: artifactContextText(artifactRun),
      channelContext: toChannelContext(message),
      conversationHistory: conversationHistoryForAgent(
        session,
        deps.userMessagePersisted ? message : undefined,
      ),
    };
    const options = deps.skills?.length ? { skills: deps.skills } : undefined;
    const requiresArtifact = Boolean(deps.artifacts) && shouldRequireArtifactForRequest(message.text);
    let result = options
      ? await program.forward(llm, input, options)
      : await program.forward(llm, input);
    let agentResponse = String(result.agentResponse ?? "");
    let artifactMessages = await artifactMessagesForTurn({
      artifacts: deps.artifacts,
      sessionId: message.conversationId,
      run: artifactRun,
      toolMessages: toolCallMessages,
      artifactIdsBeforeTurn,
    });
    if (requiresArtifact && artifactMessages.length === 0) {
      const repairInput = {
        ...input,
        userRequest: artifactRepairRequest(message.text, artifactRun.runOutboxPath),
      };
      result = options
        ? await program.forward(llm, repairInput, options)
        : await program.forward(llm, repairInput);
      agentResponse = String(result.agentResponse ?? "");
      artifactMessages = await artifactMessagesForTurn({
        artifacts: deps.artifacts,
        sessionId: message.conversationId,
        run: artifactRun,
        toolMessages: toolCallMessages,
        artifactIdsBeforeTurn,
      });
    }
    if (requiresArtifact && artifactMessages.length === 0) {
      agentResponse = "I could not create or publish the requested file in this turn.";
    }
    deps.sessions.appendMessages(
      message.conversationId,
      turnMessages(message, toolCallMessages, assistantTextMessage(agentResponse), deps, artifactMessages),
    );
    await deps.flushSessionState?.();
    if (deps.usage) {
      captureProgramUsage(program, {
        store: deps.usage,
        purpose: "chat",
        sessionId: message.conversationId,
      });
    }
    enqueueAutoMemoryTask(deps, message.conversationId);
    deps.events.emit({
      type: "agent.completed",
      conversationId: message.conversationId,
      agentResponse,
    });
    return {
      channelId: message.channelId,
      conversationId: message.conversationId,
      text: agentResponse,
      status: "completed",
    };
  } catch (error) {
    if (error instanceof AxAIServiceAbortedError) {
      const stoppedText = "[stopped]";
      deps.sessions.appendMessages(
        message.conversationId,
        turnMessages(
          message,
          toolCallMessages,
          assistantTextMessage(stoppedText, { status: "cancelled" }),
          deps,
          await artifactMessagesForTurn({
            artifacts: deps.artifacts,
            sessionId: message.conversationId,
            run: artifactRun,
            toolMessages: toolCallMessages,
            artifactIdsBeforeTurn,
          }),
        ),
      );
      deps.events.emit({
        type: "agent.completed",
        conversationId: message.conversationId,
        agentResponse: stoppedText,
      });
      return {
        channelId: message.channelId,
        conversationId: message.conversationId,
        text: stoppedText,
        status: "cancelled",
      };
    }
    if (isClarificationPause(error)) {
      const fallbackAnswer = urlPrefetch?.fallbackAnswer ?? searchPrefetch?.fallbackAnswer;
      if (fallbackAnswer) {
        deps.sessions.appendMessages(
          message.conversationId,
          turnMessages(
            message,
            toolCallMessages,
            assistantTextMessage(fallbackAnswer),
            deps,
            await artifactMessagesForTurn({
              artifacts: deps.artifacts,
              sessionId: message.conversationId,
              run: artifactRun,
              toolMessages: toolCallMessages,
              artifactIdsBeforeTurn,
            }),
          ),
        );
        await deps.flushSessionState?.();
        deps.events.emit({
          type: "agent.completed",
          conversationId: message.conversationId,
          agentResponse: fallbackAnswer,
        });
        return {
          channelId: message.channelId,
          conversationId: message.conversationId,
          text: fallbackAnswer,
          status: "completed",
        };
      }
      const question = error.question;
      deps.events.emit({
        type: "agent.clarification",
        conversationId: message.conversationId,
        question,
      });
      deps.sessions.appendMessages(
        message.conversationId,
        turnMessages(
          message,
          toolCallMessages,
          assistantTextMessage(question),
          deps,
          await artifactMessagesForTurn({
            artifacts: deps.artifacts,
            sessionId: message.conversationId,
            run: artifactRun,
            toolMessages: toolCallMessages,
            artifactIdsBeforeTurn,
          }),
        ),
      );
      return {
        channelId: message.channelId,
        conversationId: message.conversationId,
        text: question,
        status: "completed",
      };
    }
    const errorText = userFacingErrorText(error);
    const reply = errorText;
    deps.sessions.appendMessages(
      message.conversationId,
      turnMessages(
        message,
        toolCallMessages,
        assistantTextMessage(reply, { status: "failed" }),
        deps,
        await artifactMessagesForTurn({
          artifacts: deps.artifacts,
          sessionId: message.conversationId,
          run: artifactRun,
          toolMessages: toolCallMessages,
          artifactIdsBeforeTurn,
        }),
      ),
    );
    deps.events.emit({
      type: "error",
      conversationId: message.conversationId,
      message: errorText,
      cause: error,
    });
    return {
      channelId: message.channelId,
      conversationId: message.conversationId,
      text: reply,
      status: "failed",
    };
  } finally {
    deps.activeRuns?.clear(message.conversationId);
    if (deps.config.traceEnabled) {
      await appendChatLogToTraces(deps.config, safeGetChatLog(program), deps.events);
    }
  }
}

function shouldRecordFunctionCall(call: unknown): boolean {
  if (!call || typeof call !== "object" || !("kind" in call)) return true;
  return (call as { kind?: unknown }).kind === "external";
}

function enqueueAutoMemoryTask(deps: RunMessageDeps, conversationId: string): void {
  if (!deps.memoryQueue) return;
  // Sub-sessions are managed by the memory queue itself; don't recurse.
  const summary = deps.sessions.getSummary(conversationId);
  if (summary?.parentSessionId) return;
  void deps.memoryQueue
    .enqueueAuto(conversationId)
    .catch((error) => {
      deps.events.emit({
        type: "error",
        conversationId,
        message: error instanceof Error ? error.message : "Failed to enqueue memory task",
      });
    });
}
