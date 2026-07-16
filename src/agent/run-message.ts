import {
  AxAIServiceAbortedError,
  type AxAgentSkillResult,
  type AxAgentSkillsSearchFn,
  type AxAgentUsedSkill,
} from "@ax-llm/ax";
import type { ActiveRunRegistry, StoppableProgram } from "./active-runs";
import type { ChannelMessage, ChannelReply } from "../channel/types";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SqliteMemoryStore } from "../memory/memory-store"; import type { SqliteEpisodeStore } from "../episodes/episode-store";
import type { SqliteTranscriptRecallStore } from "../retrieval/transcript-recall";
import type { SqliteArtifactStore } from "../artifacts/artifact-store"; import type { MemoryQueue } from "../memory/memory-queue";
import type { NotificationCreate } from "../notifications/types";
import type { SqliteUsageStore } from "../usage/usage-store"; import type { SqliteTrainingDataStore } from "../training-data/store";
import type { SqliteSkillsStore } from "../skills/skills-store"; import type { SqliteKnowledgeStore } from "../knowledge/knowledge-store";
import { captureProgramUsage, usageAttributionForConfig } from "../usage/capture";
import type { SandboxProvider } from "../sandbox/provider";
import type { SessionManager } from "../session/session-manager";
import type { UserProfile } from "../profile/types"; import { userProfileForAgent } from "../profile/service";
import type { SoulProfile } from "../soul/types";
import type { AssistantToolCallMessage } from "../session/types";
import { isClarificationPause } from "./clarification";
import { normalizeClarification } from "./clarification-payload";
import {
  notifyClarification,
  resolveClarificationNotifications,
  type NotificationActionResolver,
} from "./clarification-notifications";
import { userFacingErrorText } from "./error-copy";
import {
  artifactContextText,
  artifactIdsForRun,
  artifactMessagesForTurn,
  createArtifactRunContext,
} from "./artifact-turn";
import { shouldRequireArtifactForRequest } from "./artifact-intent";
import { createAithyAgent, type AxAgentMemoriesSearchFn, type CreateAithyAgentOptions } from "./create-agent";
import {
  assistantTextMessage,
  conversationHistoryForAgent,
  createAgentStatusHandler,
  createTurnDeltaPublisher,
  safeGetChatLog,
  toChannelContext,
  toolCallMessage,
  turnMessages,
  wrapSkillsSearch,
} from "./run-message-helpers";
import type { ToolContext } from "./tool-context";
import { createAgentTools } from "./tools";
import { createMcpAgentTools } from "../mcp/agent-tools";
import type { McpRegistrySnapshot } from "../mcp/types";
import type { CapabilityBroker } from "../security/capability-broker";
import type { RuntimeStore } from "../runtime/runtime-store";
import type { SqliteTaskStore } from "../tasks/task-store"; import type { AutomationToolActions } from "../automations/tool-actions";
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
import {
  memoryContextText,
  preRecallQueries,
  recallForAgent,
} from "./memory-recall-context";
import { forwardTurnWithArtifactRepair } from "./turn-forward"; import { knowledgeContextText, preloadKnowledge } from "./knowledge-context";

export interface RunMessageDeps {
  config: AppConfig;
  events: EventBus;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  soul?: SoulProfile;
  profile?: UserProfile;
  memory?: SqliteMemoryStore;
  knowledge?: SqliteKnowledgeStore;
  episodes?: SqliteEpisodeStore;
  transcripts?: SqliteTranscriptRecallStore;
  artifacts?: SqliteArtifactStore;
  memoryQueue?: MemoryQueue;
  usage?: SqliteUsageStore;
  trainingData?: SqliteTrainingDataStore;
  skillsSearch?: AxAgentSkillsSearchFn;
  skills?: readonly AxAgentSkillResult[];
  skillsStore?: SqliteSkillsStore;
  skillsCatalog?: CreateAithyAgentOptions["skillsCatalog"];
  responderPlaybook?: CreateAithyAgentOptions["responderPlaybook"];
  loadedSkillIds?: Set<string>;
  onLoadedSkills?: (results: readonly AxAgentSkillResult[]) => void | Promise<void>;
  onUsedSkills?: (usedSkills: readonly AxAgentUsedSkill[]) => void | Promise<void>;
  agentFactory?: typeof createAithyAgent;
  activeRuns?: ActiveRunRegistry;
  notify?: (input: NotificationCreate) => void;
  resolveNotificationActions?: NotificationActionResolver;
  userMessagePersisted?: boolean;
  capabilities?: CapabilityBroker;
  runtimeStore?: RuntimeStore;
  tasks?: SqliteTaskStore;
  automations?: AutomationToolActions;
  mcpSnapshots?: readonly McpRegistrySnapshot[];
  taskId?: string;
  flushSessionState?: () => Promise<void>;
  urlPrefetcher?: UrlPrefetcher;
  searchPrefetcher?: SearchPrefetcher;
  logRetrieval?: (message: string, detail?: unknown) => void;
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
  resolveClarificationNotifications(deps.resolveNotificationActions, message.conversationId);

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
    knowledge: deps.knowledge,
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
  const onSkillsSearch = wrapSkillsSearch(deps.skillsSearch, toolCallMessages, publishToolCall, deps.logRetrieval);
  const memoryStore = deps.memory;
  const episodeStore = deps.episodes;
  const transcriptStore = deps.transcripts;
  const preloadedMemoryIds = new Set<string>();
  const onMemoriesSearch: AxAgentMemoriesSearchFn | undefined = memoryStore || episodeStore || transcriptStore
    ? async (searches, alreadyLoaded) => {
      const loadedIds = [...preloadedMemoryIds, ...alreadyLoaded.map((m) => m.id)];
      const recalled = await recallForAgent({
        searches,
        alreadyLoadedIds: loadedIds,
        memoryStore,
        episodeStore,
        transcriptStore,
        sessions: deps.sessions,
        workspaceRoot: deps.config.workspaceRoot,
        conversationId: message.conversationId,
        source: "recall",
        limit: 5,
        beforeCreatedAt: message.createdAt.toISOString(),
      });
      const toolMessage = recalled.toolMessage;
      toolCallMessages.push(toolMessage);
      publishToolCall(toolMessage);
      deps.logRetrieval?.("memory recall", toolMessage.toolResult);
      return recalled.memories;
    }
    : undefined;
  const { program, llm } = agentFactory({
    config: deps.config,
    runtimeStore: deps.runtimeStore,
    tools: [
      ...createAgentTools(toolContext, deps.config),
      ...createMcpAgentTools(deps.mcpSnapshots ?? [], toolContext),
    ],
    events: deps.events,
    conversationId: message.conversationId,
    soul: deps.soul,
    skillsCatalog: deps.skillsCatalog, responderPlaybook: deps.responderPlaybook,
    onSkillsSearch,
    onLoadedSkills: deps.onLoadedSkills,
    onUsedSkills: deps.onUsedSkills,
    onMemoriesSearch,
    onAgentStatus: createAgentStatusHandler(deps.events, message.conversationId),
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
    const [preRecall, knowledgeMatches] = await Promise.all([
      memoryStore || episodeStore || transcriptStore
      ? recallForAgent({
          searches: preRecallQueries(session, message),
          alreadyLoadedIds: [],
          memoryStore,
          episodeStore,
          transcriptStore,
          sessions: deps.sessions,
          workspaceRoot: deps.config.workspaceRoot,
          conversationId: message.conversationId,
          source: "preload",
          limit: 8,
          beforeCreatedAt: message.createdAt.toISOString(),
        })
      : undefined,
      Promise.resolve(preloadKnowledge(deps.knowledge, message.text)),
    ]);
    if (preRecall) {
      preRecall.hitIds.forEach((id) => preloadedMemoryIds.add(id));
      toolCallMessages.push(preRecall.toolMessage);
      publishToolCall(preRecall.toolMessage);
      deps.logRetrieval?.("memory preload", preRecall.toolMessage.toolResult);
    }
    if (knowledgeMatches.length) deps.logRetrieval?.("knowledge preload", { source: "knowledge", mode: deps.knowledge?.isRerankReady() ? "hybrid-reranked" : deps.knowledge?.isHybridReady() ? "hybrid" : "fts-only", finalMatches: knowledgeMatches.length });
    const userProfile = userProfileForAgent(deps.profile); const input = {
      ...(userProfile ? { userProfile } : {}),
      userRequest: message.text,
      ...(preRecall ? { memoryContext: memoryContextText(preRecall.memories) } : {}),
      ...(knowledgeMatches.length ? { knowledgeContext: knowledgeContextText(knowledgeMatches) } : {}),
      ...(urlPrefetch?.context ? { urlContext: urlPrefetch.context } : {}),
      ...(searchPrefetch?.context ? { searchContext: searchPrefetch.context } : {}),
      artifactContext: artifactContextText(
        artifactRun,
        deps.artifacts?.recentForSession(message.conversationId, 10) ?? [],
      ),
      channelContext: toChannelContext(message),
      conversationHistory: conversationHistoryForAgent(
        session,
        deps.userMessagePersisted ? message : undefined,
      ),
    };
    const options = deps.skills?.length ? { skills: deps.skills } : undefined;
    const requiresArtifact = Boolean(deps.artifacts) && shouldRequireArtifactForRequest(message.text);
    const { agentResponse, artifactMessages } = await forwardTurnWithArtifactRepair({
      program,
      llm,
      values: input,
      options,
      originalRequest: message.text,
      requiresArtifact,
      artifacts: deps.artifacts,
      sessionId: message.conversationId,
      run: artifactRun,
      toolMessages: toolCallMessages,
      artifactIdsBeforeTurn,
      onDeltaForTurnKey: (turnKey) => createTurnDeltaPublisher(
        deps.events,
        message.conversationId,
        turnKey,
      ),
    });
    deps.sessions.appendMessages(
      message.conversationId,
      turnMessages(message, toolCallMessages, assistantTextMessage(agentResponse), deps, artifactMessages),
    );
    await deps.flushSessionState?.();
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
      const clarification = normalizeClarification(error.clarification);
      deps.events.emit({
        type: "agent.clarification",
        conversationId: message.conversationId,
        question,
      });
      notifyClarification(deps.notify, message.conversationId, question, clarification);
      deps.sessions.appendMessages(
        message.conversationId,
        turnMessages(
          message,
          toolCallMessages,
          assistantTextMessage(question, { clarification }),
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
    if (deps.usage) {
      captureProgramUsage(program, {
        store: deps.usage,
        purpose: "chat",
        sessionId: message.conversationId,
        runId: deps.taskId ?? artifactRun.runId,
        attribution: usageAttributionForConfig(deps.config),
      });
    }
    if (deps.config.trainingDataCaptureEnabled && deps.trainingData) {
      try {
        deps.trainingData.recordChatLog({
          sessionId: message.conversationId,
          runId: deps.taskId ?? artifactRun.runId,
          entries: safeGetChatLog(program),
        });
      } catch (error) {
        deps.events.emit({
          type: "error",
          conversationId: message.conversationId,
          message: `training-data: failed to store trace data: ${
            error instanceof Error ? error.message : String(error)
          }`,
          cause: error,
        });
      }
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
