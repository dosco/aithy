import { DEFAULT_SESSION_TTL_MS } from "../config/limits";
import type { ActiveRunRegistry } from "../agent/active-runs";
import type { GlobalMount } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SandboxProvider, SessionMount } from "../sandbox/provider";
import { sessionIdFromName } from "./session-names";
import { deleteEverySession, deleteSessionTree } from "./delete-sessions";
import { computeMountName } from "./session-summary";
export { computeMountName } from "./session-summary";
import {
  mountsForSandbox as globalMountsForSandbox,
  prepareGlobalMountAdd,
  scheduleMountsRefresh,
  type AddGlobalMountResult,
} from "./global-mounts";
import { SandboxLifecycle } from "./sandbox-lifecycle";
import type { MessagePage, SessionStateStore } from "./state-store";
import {
  appendSessionMessages,
  createLiveSession,
  ensureLogicalSessionRecord,
  getSummaryRecord,
  getTranscriptRecord,
  listSessionRecords,
  messagesPageRecord,
  renameSessionRecord,
  touchLiveSession,
  ZERO_TOKENS,
  type SessionRecordContext,
} from "./session-records";
import type { BotMessage, BotSession, BotSessionSummary, SessionNameSource } from "./types";

export class SessionManager {
  private readonly sessions = new Map<string, BotSession>();
  private readonly logicalSessions = new Map<string, BotSessionSummary>();
  private readonly source: string;
  private readonly botId: string;
  private readonly workspaceRoot: string;
  private readonly sandboxLifecycle: SandboxLifecycle;
  private globalMounts: GlobalMount[] = [];

  constructor(
    private readonly options: {
      sandbox: SandboxProvider;
      botId: string;
      workspaceRoot: string;
      events: EventBus;
      ttlMs?: number;
      idleParkMs?: number;
      state?: SessionStateStore;
      source?: string;
      activeRuns?: ActiveRunRegistry;
      persistGlobalMounts?: (mounts: GlobalMount[]) => void;
      globalMounts?: GlobalMount[];
    },
  ) {
    this.source = options.source ?? "unknown";
    this.botId = options.botId;
    this.workspaceRoot = options.workspaceRoot;
    this.globalMounts = options.globalMounts ?? [];
    this.sandboxLifecycle = new SandboxLifecycle({
      sandbox: options.sandbox,
      botId: this.botId,
      workspaceRoot: this.workspaceRoot,
      events: options.events,
      sessions: this.sessions,
      idleParkMs: options.idleParkMs,
      mountsForSandbox: () => this.mountsForSandbox(),
    });
  }

  async ensureBotSandbox(): Promise<void> {
    await this.sandboxLifecycle.ensureBotSandbox();
  }

  async get(
    conversationId: string,
    options: { name?: string; nameSource?: SessionNameSource } = {},
  ): Promise<BotSession> {
    const sandboxId = await this.sandboxLifecycle.ensureBotSandbox();
    const existing = this.sessions.get(conversationId);
    if (existing && existing.expiresAt > new Date()) {
      touchLiveSession(this.recordContext(), existing);
      return existing;
    }
    if (existing) await this.destroy(conversationId);
    return createLiveSession(this.recordContext(), conversationId, sandboxId, options);
  }

  ensureLogicalSession(
    conversationId: string,
    options: {
      name?: string;
      nameSource?: SessionNameSource;
      parentSessionId?: string | null;
      parentMessageId?: number | null;
      source?: string;
    } = {},
  ): BotSessionSummary {
    return ensureLogicalSessionRecord(this.recordContext(), conversationId, options);
  }

  createSubSession(input: {
    parentSessionId: string;
    parentMessageId?: number | null;
    name?: string;
    source?: string;
  }): BotSessionSummary {
    return this.ensureLogicalSession(`sub-${crypto.randomUUID()}`, {
      name: input.name,
      parentSessionId: input.parentSessionId,
      parentMessageId: input.parentMessageId ?? null,
      source: input.source,
    });
  }

  listChildSessions(parentSessionId: string): BotSessionSummary[] {
    return this.options.state?.childSessions(parentSessionId) ?? [];
  }

  lastMessageId(conversationId: string): number | null {
    return this.options.state?.lastMessageId(conversationId) ?? null;
  }

  uniqueSessionIdForName(name: string): string {
    const base = sessionIdFromName(name);
    let candidate = base;
    let suffix = 2;
    while (this.getSummary(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  getSummary(conversationId: string): BotSessionSummary | undefined {
    return getSummaryRecord(this.recordContext(), conversationId);
  }

  listSessions(): BotSessionSummary[] {
    return listSessionRecords(this.recordContext());
  }

  getTranscript(conversationId: string): BotMessage[] {
    return getTranscriptRecord(this.recordContext(), conversationId);
  }

  messagesPage(conversationId: string, input: { beforeId?: number | null; limit: number }): MessagePage {
    return messagesPageRecord(this.recordContext(), conversationId, input);
  }

  findSessionsByName(name: string): BotSessionSummary[] {
    return this.listSessions().filter((session) => session.name === name);
  }

  renameSession(conversationId: string, name: string): BotSessionSummary | undefined {
    return renameSessionRecord(this.recordContext(), conversationId, name);
  }

  appendMessages(conversationId: string, messages: BotMessage[]): void {
    appendSessionMessages(this.recordContext(), conversationId, messages);
  }

  listGlobalMounts(): GlobalMount[] {
    return [...this.globalMounts];
  }

  setGlobalMounts(mounts: GlobalMount[]): void {
    this.globalMounts = [...mounts];
  }

  mountsForSandbox(): SessionMount[] {
    return globalMountsForSandbox(this.globalMounts);
  }

  async addGlobalMount(hostPath: string, callerConversationId?: string): Promise<AddGlobalMountResult> {
    const prepared = prepareGlobalMountAdd(this.globalMounts, hostPath);
    if (!prepared.next) return prepared.result;
    this.globalMounts = prepared.next;
    this.options.persistGlobalMounts?.(prepared.next);
    await this.scheduleMountsRefresh(callerConversationId);
    return prepared.result;
  }

  refreshMounts(conversationId?: string): Promise<void> {
    return this.sandboxLifecycle.refreshMounts(conversationId);
  }

  refreshAllMounts(): void {
    void this.scheduleMountsRefresh(undefined);
  }

  async clear(conversationId: string): Promise<void> {
    const active = this.sessions.get(conversationId);
    if (active) {
      active.messages = [];
      active.tokenTotals = { ...ZERO_TOKENS };
      active.updatedAt = new Date().toISOString();
      await this.destroy(conversationId);
    }
    const now = new Date().toISOString();
    const summary = this.getSummary(conversationId) ?? this.ensureLogicalSession(conversationId);
    this.options.state?.clearSession(conversationId, now);
    if (!this.options.state) {
      this.logicalSessions.set(conversationId, { ...summary, tokenTotals: { ...ZERO_TOKENS }, updatedAt: now });
    }
  }

  deleteSession(conversationId: string): Promise<string[]> {
    return deleteSessionTree(this.deleteContext(), conversationId);
  }

  deleteAllSessions(): Promise<string[]> {
    return deleteEverySession(this.deleteContext());
  }

  async sweepExpired(now = new Date()): Promise<void> {
    for (const [conversationId, session] of [...this.sessions]) {
      if (session.expiresAt <= now) await this.destroy(conversationId);
    }
    await this.sandboxLifecycle.sweepExpired(now);
  }

  async replaceSandboxProvider(sandbox: SandboxProvider): Promise<void> {
    await this.sandboxLifecycle.replaceProvider(sandbox);
    this.options.sandbox = sandbox;
  }

  setTtlMs(ttlMs: number): void {
    this.options.ttlMs = ttlMs;
  }

  setIdleParkMs(idleParkMs: number): void {
    this.options.idleParkMs = idleParkMs;
    this.sandboxLifecycle.setIdleParkMs(idleParkMs);
  }

  async destroy(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    this.sessions.delete(conversationId);
    this.options.events.emit({
      type: "sandbox.destroyed",
      conversationId,
      sessionId: session.sandboxSessionId,
    });
  }

  closeState(): void {
    this.options.state?.close?.();
  }

  parkAll(): Promise<void> {
    return this.sandboxLifecycle.parkAll();
  }

  private scheduleMountsRefresh(callerConversationId?: string): Promise<void> {
    return scheduleMountsRefresh({
      activeRuns: this.options.activeRuns,
      sessions: this.sessions,
      events: this.options.events,
      botId: this.botId,
      callerConversationId,
      refresh: (id) => this.refreshMounts(id),
    });
  }

  private recordContext(): SessionRecordContext {
    return {
      sessions: this.sessions,
      logicalSessions: this.logicalSessions,
      state: this.options.state,
      source: this.source,
      workspaceRoot: this.workspaceRoot,
      nextExpiry: () => this.nextExpiry(),
    };
  }

  private nextExpiry(): Date {
    return new Date(Date.now() + (this.options.ttlMs ?? DEFAULT_SESSION_TTL_MS));
  }

  private deleteContext() {
    return {
      sessions: this.sessions,
      logicalSessions: this.logicalSessions,
      state: this.options.state,
      activeRuns: this.options.activeRuns,
      destroy: (id: string) => this.destroy(id),
    };
  }
}
