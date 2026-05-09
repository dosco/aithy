import type { ChannelCommand, ChannelReply } from "../channel/types";
import type { SessionManager } from "../session/session-manager";
import { isSafeSessionId } from "../session/session-names";
import type { BotSessionSummary } from "../session/types";

export interface SlashCommandDeps {
  sessions: SessionManager;
}

export interface SlashCommandResult {
  reply: ChannelReply;
  activeConversationId?: string;
}

export async function handleSlashCommand(
  command: ChannelCommand,
  deps: SlashCommandDeps,
): Promise<SlashCommandResult> {
  const parsed = parseCommand(command.text);
  if (!parsed) return result(command, unknownCommand(command.text));

  if (parsed.name === "help") return result(command, helpText());
  if (parsed.name === "skills") return result(command, "Open the skills selector from the chat composer.");
  if (parsed.name === "session") {
    return handleSessionCommand(command, parsed.rest, deps);
  }
  return result(command, unknownCommand(parsed.name));
}

function handleSessionCommand(
  command: ChannelCommand,
  rest: string,
  deps: SlashCommandDeps,
): SlashCommandResult {
  const arg = parseSessionArgument(rest);
  if (!arg) {
    return result(command, `Current session: ${sessionLabel(currentSummary(command, deps))}`);
  }

  if (!arg.quoted) {
    const byId = deps.sessions.getSummary(arg.value);
    if (byId) return switchResult(command, byId);
    const matches = deps.sessions.findSessionsByName(arg.value);
    if (matches.length === 1) return switchResult(command, matches[0]);
    if (matches.length > 1) return result(command, ambiguousNameText(arg.value, matches));
    if (!isSafeSessionId(arg.value)) {
      return result(command, "Session ids may use letters, numbers, dot, dash, or underscore.");
    }
    const created = deps.sessions.ensureLogicalSession(arg.value);
    return switchResult(command, created);
  }

  const matches = deps.sessions.findSessionsByName(arg.value);
  if (matches.length === 1) return switchResult(command, matches[0]);
  if (matches.length > 1) return result(command, ambiguousNameText(arg.value, matches));
  const created = deps.sessions.ensureLogicalSession(
    deps.sessions.uniqueSessionIdForName(arg.value),
    { name: arg.value, nameSource: "manual" },
  );
  return switchResult(command, created);
}

function parseCommand(input: string): { name: string; rest: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
  const name = rawName?.toLowerCase();
  return name ? { name, rest: rest.join(" ").trim() } : undefined;
}

function parseSessionArgument(rest: string): { value: string; quoted: boolean } | undefined {
  if (!rest.trim()) return undefined;
  const trimmed = rest.trim();
  if (!trimmed.startsWith("\"")) return { value: trimmed.split(/\s+/)[0], quoted: false };
  const end = trimmed.indexOf("\"", 1);
  if (end < 0) return { value: trimmed.slice(1).trim(), quoted: true };
  return { value: trimmed.slice(1, end).trim(), quoted: true };
}

function switchResult(command: ChannelCommand, summary: BotSessionSummary): SlashCommandResult {
  return {
    reply: {
      channelId: command.channelId,
      conversationId: summary.conversationId,
      text: `Switched to ${sessionLabel(summary)}.`,
    },
    activeConversationId: summary.conversationId,
  };
}

function result(command: ChannelCommand, text: string): SlashCommandResult {
  return {
    reply: {
      channelId: command.channelId,
      conversationId: command.conversationId,
      text,
    },
  };
}

function currentSummary(command: ChannelCommand, deps: SlashCommandDeps): BotSessionSummary {
  return deps.sessions.getSummary(command.conversationId)
    ?? deps.sessions.ensureLogicalSession(command.conversationId);
}

function helpText(): string {
  return [
    "Commands:",
    "/help",
    "/skills",
    "/session",
    "/session <id | \"name\">",
  ].join("\n");
}

function unknownCommand(name: string): string {
  return `Unknown command: ${name}. Type /help for available commands.`;
}

function ambiguousNameText(name: string, matches: BotSessionSummary[]): string {
  const lines = matches.map((session) => `${session.conversationId} - ${session.name}`);
  return [`Multiple sessions named "${name}". Use one of these ids:`, ...lines].join("\n");
}

function sessionLabel(session: BotSessionSummary): string {
  return `"${session.name}" (${session.conversationId})`;
}
