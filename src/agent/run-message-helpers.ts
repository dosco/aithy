import type {
  AxAgentFunctionCall,
  AxAgentSkillsSearchFn,
  AxFunctionCallTrace,
} from "@ax-llm/ax";
import { MAX_CONVERSATION_HISTORY_TEXT_CHARS } from "../config/limits";
import type { ChannelMessage } from "../channel/types";
import type {
  AssistantTextMessage,
  AssistantToolCallMessage,
  BotMessage,
  BotSession,
  UserMessage,
} from "../session/types";
import type { RunMessageDeps } from "./run-message";
import type { TurnTraceChatLog } from "./trace-writer";

export function safeGetChatLog(program: unknown): TurnTraceChatLog {
  const empty: TurnTraceChatLog = { actor: [], responder: [] };
  const fn = (program as { getChatLog?: () => unknown })?.getChatLog;
  if (typeof fn !== "function") return empty;
  try {
    const log = fn.call(program) as Partial<TurnTraceChatLog> | null | undefined;
    return {
      actor: Array.isArray(log?.actor) ? log.actor : [],
      responder: Array.isArray(log?.responder) ? log.responder : [],
    };
  } catch {
    return empty;
  }
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
): AxAgentSkillsSearchFn | undefined {
  if (!inner) return undefined;
  return async (queries) => {
    const results = await inner(queries);
    const message: AssistantToolCallMessage = {
      role: "assistant",
      kind: "tool_call",
      toolName: "skills.search",
      toolArgs: { queries: [...queries] },
      toolResult: {
        matches: results.map((r) => ({
          name: r.name,
          contentBytes: r.content.length,
          contentPreview: compactPreview(r.content),
        })),
      },
      createdAt: new Date().toISOString(),
    };
    sink.push(message);
    onMessage?.(message);
    return results;
  };
}

export function assistantTextMessage(text: string): AssistantTextMessage {
  return {
    role: "assistant",
    kind: "text",
    content: trimHistoryText(text),
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
      content: `Published artifact: ${message.title} (${message.sandboxPath})`,
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
