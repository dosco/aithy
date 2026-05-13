import type {
  LogicalSessionInput,
  MessagePage,
  MessagePageInput,
  SessionStateStore,
  StoredSession,
} from "../../../session/state-store";
import type { BotMessage, BotSessionSummary } from "../../../session/types";
import type { QueueServiceClient } from "./client";

export class RemoteSessionStateStore implements SessionStateStore {
  private readonly summaries = new Map<string, BotSessionSummary>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly pages = new Map<string, MessagePage>();
  private readonly lastMessageIds = new Map<string, number>();
  private readonly pending: Promise<unknown>[] = [];
  private readonly errors: Error[] = [];
  private loadedAll = false;

  constructor(private readonly client: QueueServiceClient) {}

  async preloadAll(): Promise<void> {
    const sessions = await this.client.listSessions();
    this.summaries.clear();
    for (const session of sessions) this.summaries.set(session.conversationId, session);
    this.loadedAll = true;
  }

  async preloadSession(conversationId: string): Promise<void> {
    const session = await this.client.loadSession(conversationId);
    if (session) this.cacheSession(session);
    this.rememberLastMessageId(conversationId, await this.client.lastMessageId(conversationId));
  }

  async preloadMessages(conversationId: string, input: MessagePageInput): Promise<void> {
    const page = await this.client.messagesPage(conversationId, input);
    this.pages.set(pageKey(conversationId, input), page);
    this.rememberLastMessageIdFromPage(conversationId, page);
    const summary = await this.client.sessionSummary(conversationId);
    if (summary) this.summaries.set(conversationId, summary);
  }

  async flush(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0);
      await Promise.all(batch);
    }
    const error = this.errors.shift();
    if (error) throw error;
  }

  ensureSession(input: LogicalSessionInput): void {
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
    this.track(this.client.ensureSession(input).then((next) => {
      this.summaries.set(next.conversationId, next);
    }));
  }

  loadSession(conversationId: string): StoredSession | undefined {
    return this.sessions.get(conversationId);
  }

  listSessions(): BotSessionSummary[] {
    return [...this.summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  findSessionsByName(name: string): BotSessionSummary[] {
    return this.listSessions().filter((session) => session.name === name);
  }

  getSummary(conversationId: string): BotSessionSummary | undefined {
    return this.summaries.get(conversationId);
  }

  renameSession(conversationId: string, name: string): void {
    const existing = this.summaries.get(conversationId);
    if (existing) {
      this.summaries.set(conversationId, {
        ...existing,
        name,
        nameSource: "manual",
        updatedAt: new Date().toISOString(),
      });
    }
    this.track(this.client.renameSession(conversationId, name).then((summary) => {
      if (summary) this.summaries.set(conversationId, summary);
    }));
  }

  clearSession(conversationId: string, now: string): void {
    const existing = this.summaries.get(conversationId);
    if (existing) this.summaries.set(conversationId, { ...existing, updatedAt: now, tokenTotals: zeroTokens() });
    this.sessions.delete(conversationId);
    this.lastMessageIds.delete(conversationId);
    this.clearPages(conversationId);
    this.track(this.client.clearSession(conversationId, now).then((summary) => {
      this.summaries.set(conversationId, summary);
    }));
  }

  deleteSession(conversationId: string): void {
    this.summaries.delete(conversationId);
    this.sessions.delete(conversationId);
    this.lastMessageIds.delete(conversationId);
    this.clearPages(conversationId);
    this.track(this.client.deleteSession(conversationId));
  }

  deleteAllSessions(): void {
    this.summaries.clear();
    this.sessions.clear();
    this.pages.clear();
    this.lastMessageIds.clear();
    this.loadedAll = true;
    this.track(this.client.deleteAllSessions());
  }

  appendMessages(conversationId: string, messages: BotMessage[]): void {
    if (messages.length === 0) return;
    const loaded = this.sessions.get(conversationId);
    if (loaded) loaded.messages.push(...messages);
    this.clearPages(conversationId);
    this.track(this.client.appendMessages(conversationId, messages).then(async (page) => {
      this.rememberLastMessageIdFromPage(conversationId, page);
      const session = await this.client.loadSession(conversationId);
      if (session) this.cacheSession(session);
    }));
  }

  messagesPage(conversationId: string, input: MessagePageInput): MessagePage {
    return this.pages.get(pageKey(conversationId, input)) ?? {
      items: [],
      oldestId: null,
      newestId: null,
      hasMoreBefore: false,
    };
  }

  childSessions(parentId: string): BotSessionSummary[] {
    return this.listSessions().filter((session) => session.parentSessionId === parentId);
  }

  lastMessageId(conversationId: string): number | null {
    return this.lastMessageIds.get(conversationId) ?? null;
  }

  close(): void {}

  isLoadedAll(): boolean {
    return this.loadedAll;
  }

  private cacheSession(session: StoredSession): void {
    this.sessions.set(session.conversationId, session);
    this.summaries.set(session.conversationId, session);
  }

  private rememberLastMessageId(conversationId: string, id: number | null): void {
    if (id === null) {
      this.lastMessageIds.delete(conversationId);
      return;
    }
    this.lastMessageIds.set(conversationId, id);
  }

  private rememberLastMessageIdFromPage(conversationId: string, page: MessagePage): void {
    if (page.newestId !== null) this.lastMessageIds.set(conversationId, page.newestId);
  }

  private track(promise: Promise<unknown>): void {
    this.pending.push(promise.catch((error) => {
      this.errors.push(error instanceof Error ? error : new Error(String(error)));
    }));
  }

  private clearPages(conversationId: string): void {
    for (const key of [...this.pages.keys()]) {
      if (key.startsWith(`${conversationId}:`)) this.pages.delete(key);
    }
  }
}

function pageKey(conversationId: string, input: MessagePageInput): string {
  return `${conversationId}:${input.beforeId ?? "tail"}:${input.limit}`;
}

function zeroTokens() {
  return { input: 0, output: 0, thought: 0, total: 0 };
}
