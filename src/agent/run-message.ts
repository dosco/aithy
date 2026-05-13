import {
  AxAIServiceAbortedError,
  type AxAgentSkillResult,
  type AxAgentSkillsSearchFn,
} from "@ax-llm/ax";
import type { ActiveRunRegistry } from "./active-runs";
import type { StoppableProgram } from "./active-runs";
import type { ChannelMessage, ChannelReply } from "../channel/types";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { MemoryQueue } from "../memory/memory-queue";
import type { NotificationCreate } from "../notifications/types";
import { formatMemoryForRecall } from "../memory/format";
import type { SqliteUsageStore } from "../usage/usage-store";
import { captureProgramUsage } from "../usage/capture";
import type { SandboxProvider } from "../sandbox/provider";
import type { SessionManager } from "../session/session-manager";
import type { UserProfile } from "../profile/types";
import { userProfileForAgent } from "../profile/service";
import type { SoulProfile } from "../soul/types";
import { shouldQueueAutoMemory } from "../memory/auto-gate";
import type {
  AssistantToolCallMessage,
} from "../session/types";
import { isClarificationPause } from "./clarification";
import { createAithyAgent, type AxAgentMemoriesSearchFn } from "./create-agent";
import {
  assistantTextMessage,
  compactPreview,
  conversationHistoryForAgent,
  priorMessagesForAutoMemory,
  safeGetChatLog,
  toChannelContext,
  toolCallMessage,
  turnMessages,
  wrapSkillsSearch,
} from "./run-message-helpers";
import type { ToolContext } from "./tool-context";
import { createAgentTools } from "./tools";
import type { CapabilityBroker } from "../security/capability-broker";
import { appendChatLogToTraces } from "./trace-writer";

export interface RunMessageDeps {
  config: AppConfig;
  events: EventBus;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  soul?: SoulProfile;
  profile?: UserProfile;
  memory?: SqliteMemoryStore;
  memoryQueue?: MemoryQueue;
  usage?: SqliteUsageStore;
  skillsSearch?: AxAgentSkillsSearchFn;
  skills?: readonly AxAgentSkillResult[];
  agentFactory?: typeof createAithyAgent;
  activeRuns?: ActiveRunRegistry;
  notify?: (input: NotificationCreate) => void;
  userMessagePersisted?: boolean;
  capabilities?: CapabilityBroker;
  flushSessionState?: () => Promise<void>;
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
  const memoryQueue = deps.memoryQueue;
  const toolContext: ToolContext = {
    session,
    sandbox: deps.sandbox,
    sessions: deps.sessions,
    workspacePath: deps.config.workspaceRoot,
    events: deps.events,
    memory: deps.memory,
    enqueueRemember: memoryQueue
      ? (req) => memoryQueue.enqueueExplicit(req.sessionId, req.hint)
      : undefined,
    notify: deps.notify,
    capabilities: deps.capabilities,
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
  const onSkillsSearch = wrapSkillsSearch(deps.skillsSearch, toolCallMessages, publishToolCall);
  const memoryStore = deps.memory;
  const onMemoriesSearch: AxAgentMemoriesSearchFn | undefined = memoryStore
    ? async (searches, alreadyLoaded) => {
      const hits = await memoryStore.search([...searches], {
        limit: 5,
        excludeIds: alreadyLoaded.map((m) => m.id),
      });
      const results = hits.map((m) => ({
        id: m.id,
        content: formatMemoryForRecall(m),
      }));
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

  try {
    const userProfile = userProfileForAgent(deps.profile);
    const input = {
      ...(userProfile ? { userProfile } : {}),
      userRequest: message.text,
      channelContext: toChannelContext(message),
      conversationHistory: conversationHistoryForAgent(
        session,
        deps.userMessagePersisted ? message : undefined,
      ),
    };
    const options = deps.skills?.length ? { skills: deps.skills } : undefined;
    const result = options
      ? await program.forward(llm, input, options)
      : await program.forward(llm, input);
    const agentResponse = String(result.agentResponse ?? "");
    const shouldQueueMemory = shouldQueueAutoMemory({
      userText: message.text,
      priorMessages: priorMessagesForAutoMemory(session, message, deps.userMessagePersisted),
    });
    deps.sessions.appendMessages(
      message.conversationId,
      turnMessages(message, toolCallMessages, assistantTextMessage(agentResponse), deps),
    );
    await deps.flushSessionState?.();
    if (deps.usage) {
      captureProgramUsage(program, {
        store: deps.usage,
        purpose: "chat",
        sessionId: message.conversationId,
      });
    }
    if (shouldQueueMemory) {
      enqueueAutoMemoryTask(deps, message.conversationId);
    }
    deps.events.emit({
      type: "agent.completed",
      conversationId: message.conversationId,
      agentResponse,
    });
    return {
      channelId: message.channelId,
      conversationId: message.conversationId,
      text: agentResponse,
    };
  } catch (error) {
    if (error instanceof AxAIServiceAbortedError) {
      const stoppedText = "[stopped]";
      deps.sessions.appendMessages(
        message.conversationId,
        turnMessages(message, toolCallMessages, assistantTextMessage(stoppedText), deps),
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
      };
    }
    if (isClarificationPause(error)) {
      const question = error.question;
      deps.events.emit({
        type: "agent.clarification",
        conversationId: message.conversationId,
        question,
      });
      deps.sessions.appendMessages(
        message.conversationId,
        turnMessages(message, toolCallMessages, assistantTextMessage(question), deps),
      );
      return {
        channelId: message.channelId,
        conversationId: message.conversationId,
        text: question,
      };
    }
    const errorText = error instanceof Error ? error.message : "Unknown agent error";
    const reply = `Error: ${errorText}`;
    deps.sessions.appendMessages(
      message.conversationId,
      turnMessages(message, toolCallMessages, assistantTextMessage(reply), deps),
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
  const finalMessageId = deps.sessions.lastMessageId(conversationId);
  void deps.memoryQueue
    .enqueueAuto(conversationId, finalMessageId ?? undefined)
    .catch((error) => {
      deps.events.emit({
        type: "error",
        conversationId,
        message: error instanceof Error ? error.message : "Failed to enqueue memory task",
      });
    });
}
