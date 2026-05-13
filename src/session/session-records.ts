import { MAX_CONVERSATION_HISTORY_MESSAGES } from "../config/limits";
import type { MessagePage, SessionStateStore } from "./state-store";
import { defaultSessionName, generateSessionName } from "./session-names";
import { summaryFromSession } from "./session-summary";
import type {
  BotMessage,
  BotSession,
  BotSessionSummary,
  SessionNameSource,
  SessionTokenTotals,
} from "./types";

export const ZERO_TOKENS: SessionTokenTotals = { input: 0, output: 0, thought: 0, total: 0 };

export interface SessionRecordContext {
  sessions: Map<string, BotSession>;
  logicalSessions: Map<string, BotSessionSummary>;
  state?: SessionStateStore;
  source: string;
  workspaceRoot: string;
  nextExpiry(): Date;
}

export function createLiveSession(
  ctx: SessionRecordContext,
  conversationId: string,
  sandboxId: string,
  options: { name?: string; nameSource?: SessionNameSource } = {},
): BotSession {
  const stored = ctx.state?.loadSession(conversationId);
  const logical = ctx.logicalSessions.get(conversationId);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const session: BotSession = {
    conversationId,
    name: options.name ?? stored?.name ?? logical?.name ?? defaultSessionName(),
    nameSource: options.nameSource ?? stored?.nameSource ?? logical?.nameSource ?? "generated",
    source: stored?.source ?? logical?.source ?? ctx.source,
    model: stored?.model ?? logical?.model ?? null,
    systemPrompt: stored?.systemPrompt ?? logical?.systemPrompt ?? null,
    parentSessionId: stored?.parentSessionId ?? logical?.parentSessionId ?? null,
    parentMessageId: stored?.parentMessageId ?? logical?.parentMessageId ?? null,
    tokenTotals: stored?.tokenTotals ?? logical?.tokenTotals ?? { ...ZERO_TOKENS },
    createdAt: stored?.createdAt ?? logical?.createdAt ?? now,
    updatedAt: now,
    sandboxSessionId: sandboxId,
    messages: stored?.messages ?? [],
    workspacePath: ctx.workspaceRoot,
    expiresAt: ctx.nextExpiry(),
    lastActivityAt: nowDate,
    state: "live",
  };
  ensureLogicalSessionRecord(ctx, conversationId, {
    name: session.name,
    nameSource: session.nameSource,
  });
  ctx.sessions.set(conversationId, session);
  ctx.logicalSessions.delete(conversationId);
  return session;
}

export function touchLiveSession(ctx: SessionRecordContext, session: BotSession): void {
  session.expiresAt = ctx.nextExpiry();
  session.lastActivityAt = new Date();
  session.updatedAt = session.lastActivityAt.toISOString();
  session.state = "live";
}

export function ensureLogicalSessionRecord(
  ctx: SessionRecordContext,
  conversationId: string,
  options: {
    name?: string;
    nameSource?: SessionNameSource;
    parentSessionId?: string | null;
    parentMessageId?: number | null;
    source?: string;
  } = {},
): BotSessionSummary {
  const active = ctx.sessions.get(conversationId);
  if (active) return summaryFromSession(active);
  const stored = ctx.state?.getSummary(conversationId);
  if (stored) return stored;
  const existing = ctx.logicalSessions.get(conversationId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const summary: BotSessionSummary = {
    conversationId,
    name: options.name ?? defaultSessionName(),
    nameSource: options.nameSource ?? "generated",
    source: options.source ?? ctx.source,
    model: null,
    systemPrompt: null,
    parentSessionId: options.parentSessionId ?? null,
    parentMessageId: options.parentMessageId ?? null,
    tokenTotals: { ...ZERO_TOKENS },
    createdAt: now,
    updatedAt: now,
    expiresAt: ctx.nextExpiry(),
  };
  ctx.state?.ensureSession({
    conversationId,
    name: summary.name,
    nameSource: summary.nameSource,
    source: summary.source,
    model: summary.model,
    systemPrompt: summary.systemPrompt,
    parentSessionId: summary.parentSessionId,
    parentMessageId: summary.parentMessageId,
    now,
    expiresAt: summary.expiresAt,
  });
  if (!ctx.state) ctx.logicalSessions.set(conversationId, summary);
  return summary;
}

export function getSummaryRecord(
  ctx: Pick<SessionRecordContext, "sessions" | "logicalSessions" | "state">,
  conversationId: string,
): BotSessionSummary | undefined {
  const active = ctx.sessions.get(conversationId);
  if (active) return summaryFromSession(active);
  return ctx.state?.getSummary(conversationId) ?? ctx.logicalSessions.get(conversationId);
}

export function listSessionRecords(
  ctx: Pick<SessionRecordContext, "sessions" | "logicalSessions" | "state">,
): BotSessionSummary[] {
  const byId = new Map<string, BotSessionSummary>();
  for (const summary of ctx.state?.listSessions() ?? []) byId.set(summary.conversationId, summary);
  for (const summary of ctx.logicalSessions.values()) byId.set(summary.conversationId, summary);
  for (const session of ctx.sessions.values()) byId.set(session.conversationId, summaryFromSession(session));
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getTranscriptRecord(ctx: SessionRecordContext, conversationId: string): BotMessage[] {
  const active = ctx.sessions.get(conversationId);
  if (active) return [...active.messages];
  return ctx.state?.loadSession(conversationId)?.messages ?? [];
}

export function messagesPageRecord(
  ctx: SessionRecordContext,
  conversationId: string,
  input: { beforeId?: number | null; limit: number },
): MessagePage {
  return ctx.state?.messagesPage(conversationId, input)
    ?? { items: [], oldestId: null, newestId: null, hasMoreBefore: false };
}

export function renameSessionRecord(
  ctx: SessionRecordContext,
  conversationId: string,
  name: string,
): BotSessionSummary | undefined {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Session name cannot be empty");
  const now = new Date().toISOString();
  const active = ctx.sessions.get(conversationId);
  if (active) {
    active.name = trimmed;
    active.nameSource = "manual";
    active.updatedAt = now;
    ctx.state?.renameSession(conversationId, trimmed);
    return summaryFromSession(active);
  }
  const stored = ctx.state?.getSummary(conversationId);
  if (stored) {
    ctx.state?.renameSession(conversationId, trimmed);
    return ctx.state?.getSummary(conversationId);
  }
  const logical = ctx.logicalSessions.get(conversationId);
  if (!logical) return undefined;
  const renamed = { ...logical, name: trimmed, nameSource: "manual" as const, updatedAt: now };
  ctx.logicalSessions.set(conversationId, renamed);
  return renamed;
}

export function appendSessionMessages(
  ctx: SessionRecordContext,
  conversationId: string,
  messages: BotMessage[],
): void {
  const session = ctx.sessions.get(conversationId);
  if (!session) {
    if (ctx.state?.getSummary(conversationId)) ctx.state.appendMessages(conversationId, messages);
    return;
  }
  session.messages.push(...messages);
  if (session.messages.length > MAX_CONVERSATION_HISTORY_MESSAGES) {
    session.messages.splice(0, session.messages.length - MAX_CONVERSATION_HISTORY_MESSAGES);
  }
  for (const message of messages) {
    if (message.role === "assistant" && message.usage) {
      session.tokenTotals.input += message.usage.input;
      session.tokenTotals.output += message.usage.output;
      session.tokenTotals.thought += message.usage.thought;
      session.tokenTotals.total += message.usage.total;
    }
  }
  if (session.nameSource === "generated") {
    const firstUserContent = session.messages.find((m) => m.role === "user")?.content;
    if (firstUserContent) session.name = generateSessionName(firstUserContent);
  }
  const nowDate = new Date();
  session.updatedAt = nowDate.toISOString();
  session.lastActivityAt = nowDate;
  ctx.state?.appendMessages(conversationId, messages);
}
