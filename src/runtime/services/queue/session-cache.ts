import type { WebLiveEvent } from "../../../web/live-events";
import { messageEvent, serializableSession } from "../../../web/live-events";
import { defaultSessionName } from "../../../session/session-names";
import type { SessionStateStore, LogicalSessionInput, MessagePage, MessagePageInput, StoredSession } from "../../../session/state-store";
import type { BotMessage, BotSessionSummary } from "../../../session/types";

const DEFAULT_PAGE_LIMIT = 50;

export class QueueSessionCache {
  private summariesLoaded = false;
  private readonly summaries = new Map<string, BotSessionSummary>();
  private readonly loadedSessions = new Map<string, StoredSession>();
  private readonly pageCache = new Map<string, MessagePage>();

  constructor(
    private readonly store: SessionStateStore,
    private readonly publish: (event: WebLiveEvent) => void,
  ) {}

  ensure(input: LogicalSessionInput): BotSessionSummary {
    const existing = this.summary(input.conversationId);
    if (existing) return existing;
    this.store.ensureSession(input);
    const summary: BotSessionSummary = {
      conversationId: input.conversationId,
      name: input.name,
      nameSource: input.nameSource,
      source: input.source,
      model: input.model ?? null,
      systemPrompt: input.systemPrompt ?? null,
      parentSessionId: input.parentSessionId ?? null,
      parentMessageId: input.parentMessageId ?? null,
      tokenTotals: { input: 0, output: 0, thought: 0, total: 0 },
      createdAt: input.now,
      updatedAt: input.now,
      expiresAt: input.expiresAt,
    };
    this.summaries.set(input.conversationId, summary);
    if (!input.parentSessionId) this.publishSessions();
    return summary;
  }

  load(conversationId: string): StoredSession | undefined {
    const cached = this.loadedSessions.get(conversationId);
    if (cached) return cached;
    const stored = this.store.loadSession(conversationId);
    if (!stored) return undefined;
    this.cacheSession(stored);
    return stored;
  }

  list(): BotSessionSummary[] {
    this.ensureSummariesLoaded();
    return [...this.summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  findByName(name: string): BotSessionSummary[] {
    return this.list().filter((session) => session.name === name);
  }

  summary(conversationId: string): BotSessionSummary | undefined {
    if (this.summaries.has(conversationId)) return this.summaries.get(conversationId);
    const summary = this.store.getSummary(conversationId);
    if (summary) this.summaries.set(conversationId, summary);
    return summary;
  }

  rename(conversationId: string, name: string): BotSessionSummary | undefined {
    this.store.renameSession(conversationId, name);
    const summary = this.store.getSummary(conversationId);
    if (!summary) return undefined;
    this.summaries.set(conversationId, summary);
    const loaded = this.loadedSessions.get(conversationId);
    if (loaded) this.loadedSessions.set(conversationId, { ...loaded, ...summary });
    this.publishSessions();
    return summary;
  }

  clear(conversationId: string, now: string): BotSessionSummary {
    const summary = this.summary(conversationId) ?? this.ensure(defaultLogicalSession(conversationId, now));
    this.store.clearSession(conversationId, now);
    const next = { ...summary, tokenTotals: zeroTokens(), updatedAt: now };
    this.summaries.set(conversationId, next);
    this.loadedSessions.set(conversationId, { ...next, messages: [] });
    this.clearMessageCache(conversationId);
    this.publishSessions();
    return next;
  }

  delete(conversationId: string): void {
    this.store.deleteSession(conversationId);
    this.summaries.delete(conversationId);
    this.loadedSessions.delete(conversationId);
    this.clearMessageCache(conversationId);
    this.publishSessions();
  }

  deleteAll(): void {
    this.store.deleteAllSessions();
    this.summaries.clear();
    this.loadedSessions.clear();
    this.pageCache.clear();
    this.summariesLoaded = true;
    this.publishSessions();
  }

  appendMessages(conversationId: string, messages: BotMessage[]): MessagePage {
    if (messages.length === 0) return this.messagesPage(conversationId, { limit: DEFAULT_PAGE_LIMIT });
    const beforeMessageId = this.store.lastMessageId(conversationId);
    this.store.appendMessages(conversationId, messages);
    const stored = this.store.loadSession(conversationId);
    if (stored) this.cacheSession(stored);
    this.clearMessageCache(conversationId);
    const page = this.messagesPage(conversationId, { limit: DEFAULT_PAGE_LIMIT });
    const appended = appendedMessageRows(page, beforeMessageId);
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.role === "user" || message.kind === "text" || message.kind === "permission") {
        this.publish(messageEvent(conversationId, message, appended[index]?.id));
      }
    }
    this.publishSessions();
    return page;
  }

  messagesPage(conversationId: string, input: MessagePageInput): MessagePage {
    const key = pageKey(conversationId, input);
    const cached = this.pageCache.get(key);
    if (cached) return cached;
    const page = this.store.messagesPage(conversationId, input);
    this.pageCache.set(key, page);
    return page;
  }

  childSessions(parentId: string): BotSessionSummary[] {
    return this.list().filter((session) => session.parentSessionId === parentId);
  }

  lastMessageId(conversationId: string): number | null {
    return this.store.lastMessageId(conversationId);
  }

  close(): void {
    this.store.close?.();
  }

  private ensureSummariesLoaded(): void {
    if (this.summariesLoaded) return;
    for (const summary of this.store.listSessions()) {
      this.summaries.set(summary.conversationId, summary);
    }
    this.summariesLoaded = true;
  }

  private cacheSession(session: StoredSession): void {
    this.summaries.set(session.conversationId, session);
    this.loadedSessions.set(session.conversationId, session);
  }

  private publishSessions(): void {
    this.publish({
      type: "sessions",
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      sessions: this.list().map(serializableSession),
    });
  }

  private clearMessageCache(conversationId: string): void {
    for (const key of [...this.pageCache.keys()]) {
      if (key.startsWith(`${conversationId}:`)) this.pageCache.delete(key);
    }
  }
}

function defaultLogicalSession(conversationId: string, now: string): LogicalSessionInput {
  return {
    conversationId,
    name: defaultSessionName(),
    nameSource: "generated",
    source: "web",
    now,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

function pageKey(conversationId: string, input: MessagePageInput): string {
  return `${conversationId}:${input.beforeId ?? "tail"}:${input.limit}`;
}

function zeroTokens() {
  return { input: 0, output: 0, thought: 0, total: 0 };
}

function appendedMessageRows(page: MessagePage, beforeMessageId: number | null) {
  return page.items.filter((item) => beforeMessageId === null || item.id > beforeMessageId);
}
