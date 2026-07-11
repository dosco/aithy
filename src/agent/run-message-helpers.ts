import type {
  AxAgentFunctionCall,
  AxAgentSkillsSearchFn,
  AxFunctionCallTrace,
} from "@ax-llm/ax";
import { MAX_CONVERSATION_HISTORY_TEXT_CHARS } from "../config/limits";
import type { ChannelMessage } from "../channel/types";
import type {
  AssistantTextStatus,
  AssistantClarification,
  AssistantTextMessage,
  AssistantToolCallMessage,
  BotMessage,
  BotSession,
  UserMessage,
} from "../session/types";
import type { RunMessageDeps } from "./run-message";
import type { AxChatLogEntry } from "@ax-llm/ax";
import type { EventBus } from "../events/bus";
import type { TurnDelta } from "./turn-forward";

export function createAgentStatusHandler(events: EventBus, conversationId: string) {
  return (message: string, status: "success" | "failed") => {
    events.emit({ type: "agent.status", conversationId, message, status });
  };
}

export function createTurnDeltaPublisher(
  events: EventBus,
  conversationId: string,
  turnKey: string,
) {
  let seq = 0;
  return (delta: TurnDelta) => {
    events.emit({
      type: "agent.delta",
      conversationId,
      turnKey,
      seq: ++seq,
      text: delta.text,
      ...(delta.reset ? { reset: true } : {}),
    });
  };
}

export function safeGetChatLog(program: unknown): readonly AxChatLogEntry[] {
  const fn = (program as { getChatLog?: () => unknown })?.getChatLog;
  if (typeof fn !== "function") return [];
  try {
    return normalizeChatLogShape(fn.call(program));
  } catch {
    return [];
  }
}

function normalizeChatLogShape(value: unknown): readonly AxChatLogEntry[] {
  if (Array.isArray(value)) return value.filter(isChatLogEntry);
  if (!value || typeof value !== "object") return [];
  const split = value as { actor?: unknown; responder?: unknown };
  return [
    ...(Array.isArray(split.actor) ? split.actor.filter(isChatLogEntry) : []),
    ...(Array.isArray(split.responder) ? split.responder.filter(isChatLogEntry) : []),
  ];
}

function isChatLogEntry(value: unknown): value is AxChatLogEntry {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { model?: unknown }).model === "string"
    && Array.isArray((value as { messages?: unknown }).messages);
}

export function toChannelContext(message: ChannelMessage) {
  return {
    channelId: message.channelId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    createdAt: message.createdAt.toISOString(),
  };
}

export function conversationHistoryForAgent(
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

export function toolCallMessage(
  call: Readonly<AxFunctionCallTrace | AxAgentFunctionCall>,
): AssistantToolCallMessage {
  return {
    role: "assistant",
    kind: "tool_call",
    toolName: toolCallName(call),
    toolArgs: "args" in call ? call.args ?? null : null,
    ...("result" in call
      ? {
          toolResult: {
            ok: "ok" in call ? call.ok : undefined,
            value: serializeToolResult(call.result),
          },
        }
      : {}),
    createdAt: new Date().toISOString(),
  };
}

export function wrapSkillsSearch(
  inner: AxAgentSkillsSearchFn | undefined,
  sink: AssistantToolCallMessage[],
  onMessage?: (message: AssistantToolCallMessage) => void,
  logRetrieval?: (message: string, detail?: unknown) => void,
): AxAgentSkillsSearchFn | undefined {
  if (!inner) return undefined;
  return async (queries) => {
    const results = await inner(queries);
    const diagnostics = (results as { diagnostics?: unknown }).diagnostics;
    const message: AssistantToolCallMessage = {
      role: "assistant",
      kind: "tool_call",
      toolName: "skills.search",
      toolArgs: { queries: [...queries] },
      toolResult: {
        matches: results.map((r) => ({
          id: r.id,
          name: r.name,
          contentBytes: r.content.length,
          contentPreview: compactPreview(r.content),
        })),
        ...(diagnostics ? { diagnostics } : {}),
      },
      createdAt: new Date().toISOString(),
    };
    sink.push(message);
    onMessage?.(message);
    logRetrieval?.("skills search", message.toolResult);
    return results;
  };
}

export function assistantTextMessage(
  text: string,
  options: { status?: AssistantTextStatus; clarification?: AssistantClarification } = {},
): AssistantTextMessage {
  return {
    role: "assistant",
    kind: "text",
    content: trimHistoryText(text),
    ...(options.status ? { status: options.status } : {}),
    ...(options.clarification ? { clarification: options.clarification } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function turnMessages(
  message: ChannelMessage,
  toolCallMessages: AssistantToolCallMessage[],
  assistant: AssistantTextMessage,
  deps: RunMessageDeps,
  artifactMessages: BotMessage[] = [],
): BotMessage[] {
  return [
    ...(deps.userMessagePersisted ? [] : [userMessage(message)]),
    ...toolCallMessages,
    ...artifactMessages,
    assistant,
  ];
}

function isCurrentUserMessage(message: BotMessage, current: ChannelMessage): boolean {
  return message.role === "user"
    && message.content === trimHistoryText(current.text)
    && message.createdAt === current.createdAt.toISOString();
}

function historyEntryFor(message: BotMessage): { role: "user" | "assistant"; content: string; createdAt: string } | undefined {
  if (message.role === "user") return { role: "user", content: message.content, createdAt: message.createdAt };
  if (message.kind === "text") return { role: "assistant", content: message.content, createdAt: message.createdAt };
  if (message.kind === "artifact") {
    return {
      role: "assistant",
      content: `Published artifact: ${message.title}; filename=${message.filename}; id=${message.id}; sandboxPath=${message.sandboxPath}; openUrl=${message.openUrl}`,
      createdAt: message.createdAt,
    };
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

function serializeToolResult(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}

function toolCallName(call: Readonly<AxFunctionCallTrace | AxAgentFunctionCall>): string {
  if ("fn" in call && call.fn) return call.fn;
  if ("qualifiedName" in call && call.qualifiedName) return call.qualifiedName;
  if ("name" in call && call.name) return call.name;
  return "unknown";
}

export function compactPreview(value: string, maxChars = 2_000): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, maxChars)} [truncated]`;
}

function trimHistoryText(text: string): string {
  if (text.length <= MAX_CONVERSATION_HISTORY_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_CONVERSATION_HISTORY_TEXT_CHARS)}\n[truncated]`;
}
