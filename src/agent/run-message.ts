import {
  AxAIServiceAbortedError,
  type AxAgentSkillResult,
  type AxAgentSkillsSearchFn,
  type AxFunctionCallTrace,
} from "@ax-llm/ax";
import type { ActiveRunRegistry } from "./active-runs";
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
import type { SoulProfile } from "../soul/types";
import type {
  AssistantTextMessage,
  AssistantToolCallMessage,
  BotMessage,
  BotSession,
  UserMessage,
} from "../session/types";
import {
  MAX_CONVERSATION_HISTORY_TEXT_CHARS,
} from "../config/limits";
import { isClarificationPause } from "./clarification";
import { createAithyAgent, type AxAgentMemoriesSearchFn } from "./create-agent";
import { isTrivialUserTurn } from "./triage-filter";
import type { ToolContext } from "./tool-context";
import { createAgentTools } from "./tools";
import type { CapabilityBroker } from "../security/capability-broker";
import type { TurnTraceChatLog } from "./trace-writer";
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
  const onSkillsSearch = wrapSkillsSearch(deps.skillsSearch, toolCallMessages);
  const memoryStore = deps.memory;
  const onMemoriesSearch: AxAgentMemoriesSearchFn | undefined = memoryStore
    ? async (searches, alreadyLoaded) => {
        const hits = await memoryStore.search([...searches], {
          limit: 5,
          excludeIds: alreadyLoaded.map((m) => m.id),
        });
        return hits.map((m) => ({
          id: m.id,
          content: formatMemoryForRecall(m),
        }));
      }
    : undefined;
  const { program, llm } = agentFactory({
    config: deps.config,
    tools: createAgentTools(toolContext, deps.config),
    events: deps.events,
    conversationId: message.conversationId,
    soul: deps.soul,
    profile: deps.profile,
    onSkillsSearch,
    onMemoriesSearch,
    onFunctionCall: (call) => {
      toolCallMessages.push(toolCallMessage(call));
    },
  });

  deps.activeRuns?.register(message.conversationId, program);
  deps.events.emit({
    type: "agent.started",
    conversationId: message.conversationId,
    provider: deps.config.aiProvider,
    model: deps.config.aiModel ?? "provider default",
  });

  try {
    const input = {
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
    deps.sessions.appendMessages(
      message.conversationId,
      turnMessages(message, toolCallMessages, assistantTextMessage(agentResponse), deps),
    );
    if (deps.usage) {
      captureProgramUsage(program, {
        store: deps.usage,
        purpose: "chat",
        sessionId: message.conversationId,
      });
    }
    if (!isTrivialUserTurn(message.text)) {
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

function safeGetChatLog(program: unknown): TurnTraceChatLog {
  const empty: TurnTraceChatLog = { actor: [], responder: [] };
  const fn = (program as { getChatLog?: () => TurnTraceChatLog })?.getChatLog;
  if (typeof fn !== "function") return empty;
  try {
    const log = fn.call(program);
    return {
      actor: Array.isArray(log?.actor) ? log.actor : [],
      responder: Array.isArray(log?.responder) ? log.responder : [],
    };
  } catch {
    return empty;
  }
}

function toChannelContext(message: ChannelMessage) {
  return {
    channelId: message.channelId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    createdAt: message.createdAt.toISOString(),
  };
}

interface AgentHistoryEntry {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

function conversationHistoryForAgent(
  session: BotSession,
  currentMessage?: ChannelMessage,
): string | undefined {
  const lines: string[] = [];
  for (const message of session.messages) {
    if (currentMessage && isCurrentUserMessage(message, currentMessage)) continue;
    const entry = historyEntryFor(message);
    if (entry) lines.push(`[${entry.createdAt}] ${entry.role}: ${entry.content}`);
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function isCurrentUserMessage(message: BotMessage, current: ChannelMessage): boolean {
  return message.role === "user"
    && message.content === trimHistoryText(current.text)
    && message.createdAt === current.createdAt.toISOString();
}

function historyEntryFor(message: BotMessage): AgentHistoryEntry | undefined {
  if (message.role === "user") {
    return { role: "user", content: message.content, createdAt: message.createdAt };
  }
  if (message.kind === "text") {
    return { role: "assistant", content: message.content, createdAt: message.createdAt };
  }
  return undefined;
}

function userMessage(message: ChannelMessage): UserMessage {
  return {
    role: "user",
    content: trimHistoryText(message.text),
    createdAt: message.createdAt.toISOString(),
  };
}

function toolCallMessage(call: Readonly<AxFunctionCallTrace>): AssistantToolCallMessage {
  return {
    role: "assistant",
    kind: "tool_call",
    toolName: call.fn,
    toolArgs: call.args ?? null,
    toolResult: { ok: call.ok, value: serializeToolResult(call.result) },
    createdAt: new Date().toISOString(),
  };
}

function serializeToolResult(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}

function wrapSkillsSearch(
  inner: AxAgentSkillsSearchFn | undefined,
  sink: AssistantToolCallMessage[],
): AxAgentSkillsSearchFn | undefined {
  if (!inner) return undefined;
  return async (queries) => {
    const results = await inner(queries);
    sink.push({
      role: "assistant",
      kind: "tool_call",
      toolName: "skills.search",
      toolArgs: { queries: [...queries] },
      toolResult: {
        matches: results.map((r) => ({
          name: r.name,
          contentBytes: r.content.length,
        })),
      },
      createdAt: new Date().toISOString(),
    });
    return results;
  };
}

function assistantTextMessage(text: string): AssistantTextMessage {
  return {
    role: "assistant",
    kind: "text",
    content: trimHistoryText(text),
    createdAt: new Date().toISOString(),
  };
}

function turnMessages(
  message: ChannelMessage,
  toolCallMessages: AssistantToolCallMessage[],
  assistant: AssistantTextMessage,
  deps: RunMessageDeps,
): BotMessage[] {
  return [
    ...(deps.userMessagePersisted ? [] : [userMessage(message)]),
    ...toolCallMessages,
    assistant,
  ];
}

function trimHistoryText(text: string): string {
  if (text.length <= MAX_CONVERSATION_HISTORY_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONVERSATION_HISTORY_TEXT_CHARS)}\n[truncated]`;
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
