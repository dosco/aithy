import { DEFAULT_IDLE_PARK_MS, DEFAULT_SESSION_TTL_MS, MAX_CONVERSATION_HISTORY_MESSAGES } from "../config/limits";
import type { ActiveRunRegistry } from "../agent/active-runs";
import type { GlobalMount } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SandboxProvider, SessionMount } from "../sandbox/provider";
import { defaultSessionName, generateSessionName, sessionIdFromName } from "./session-names";
import { deleteEverySession, deleteSessionTree } from "./delete-sessions";
import { computeMountName, summaryFromSession } from "./session-summary";
export { computeMountName } from "./session-summary";
import {
  mountsForSandbox as globalMountsForSandbox,
  prepareGlobalMountAdd,
  scheduleMountsRefresh,
  type AddGlobalMountResult,
} from "./global-mounts";
import type { MessagePage, SessionStateStore } from "./state-store";
import type { BotMessage, BotSession, BotSessionSummary, SessionNameSource, SessionTokenTotals } from "./types";

const ZERO_TOKENS: SessionTokenTotals = { input: 0, output: 0, thought: 0, total: 0 };

type SandboxState = "idle" | "starting" | "live" | "parking" | "parked" | "resuming";

export class SessionManager {
  private readonly sessions = new Map<string, BotSession>();
  private readonly logicalSessions = new Map<string, BotSessionSummary>();
  private readonly source: string;
  private readonly botId: string;
  private readonly workspaceRoot: string;
  private globalMounts: GlobalMount[] = [];

  private sandboxState: SandboxState = "idle";
  private sandboxId: string | null = null;
  private sandboxReady: Promise<void> | null = null;

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
    }
  ) {
    this.source = options.source ?? "unknown";
    this.botId = options.botId;
    this.workspaceRoot = options.workspaceRoot;
    this.globalMounts = options.globalMounts ?? [];
  }

  async ensureBotSandbox(): Promise<void> {
    if (this.sandboxState === "live" && this.sandboxId) return;
    if (this.sandboxReady) return this.sandboxReady;
    this.sandboxReady = this.bringSandboxLive().finally(() => {
      this.sandboxReady = null;
    });
    return this.sandboxReady;
  }

  private async bringSandboxLive(): Promise<void> {
    if (this.sandboxState === "idle") {
      this.sandboxState = "starting";
      this.options.events.emit({ type: "sandbox.starting", conversationId: this.botId });
      try {
        const sandbox = await this.options.sandbox.createSession(
          this.botId,
          this.workspaceRoot,
          this.mountsForSandbox(),
        );
        this.sandboxId = sandbox.id;
        this.sandboxState = "live";
        this.options.events.emit({ type: "sandbox.created", conversationId: this.botId, sessionId: sandbox.id });
      } catch (error) {
        this.sandboxState = "idle";
        this.sandboxId = null;
        throw error;
      }
      return;
    }
    if (this.sandboxState === "parked" && this.sandboxId) {
      this.sandboxState = "resuming";
      this.options.events.emit({ type: "sandbox.resuming", conversationId: this.botId, sessionId: this.sandboxId });
      try {
        await this.options.sandbox.resume(this.sandboxId);
        this.sandboxState = "live";
        this.options.events.emit({ type: "sandbox.created", conversationId: this.botId, sessionId: this.sandboxId });
      } catch (error) {
        this.sandboxState = "parked";
        throw error;
      }
      return;
    }
    if (!this.sandboxId) throw new Error(`Sandbox in unexpected state: ${this.sandboxState}`);
  }

  async get(
    conversationId: string,
    options: { name?: string; nameSource?: SessionNameSource } = {},
  ): Promise<BotSession> {
    await this.ensureBotSandbox();
    const sandboxId = this.sandboxId!;

    const existing = this.sessions.get(conversationId);
    if (existing && existing.expiresAt > new Date()) {
      existing.expiresAt = this.nextExpiry();
      existing.lastActivityAt = new Date();
      existing.updatedAt = existing.lastActivityAt.toISOString();
      existing.state = "live";
      return existing;
    }

    if (existing) await this.destroy(conversationId);
    const stored = this.options.state?.loadSession(conversationId);
    const logical = this.logicalSessions.get(conversationId);
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const session: BotSession = {
      conversationId,
      name: options.name ?? stored?.name ?? logical?.name ?? defaultSessionName(),
      nameSource: options.nameSource ?? stored?.nameSource ?? logical?.nameSource ?? "generated",
      source: stored?.source ?? logical?.source ?? this.source,
      model: stored?.model ?? logical?.model ?? null,
      systemPrompt: stored?.systemPrompt ?? logical?.systemPrompt ?? null,
      parentSessionId: stored?.parentSessionId ?? logical?.parentSessionId ?? null,
      parentMessageId: stored?.parentMessageId ?? logical?.parentMessageId ?? null,
      tokenTotals: stored?.tokenTotals ?? logical?.tokenTotals ?? { ...ZERO_TOKENS },
      createdAt: stored?.createdAt ?? logical?.createdAt ?? now,
      updatedAt: now,
      sandboxSessionId: sandboxId,
      messages: stored?.messages ?? [],
      workspacePath: this.workspaceRoot,
      expiresAt: this.nextExpiry(),
      lastActivityAt: nowDate,
      state: "live",
    };
    this.ensureLogicalSession(conversationId, { name: session.name, nameSource: session.nameSource });
    this.sessions.set(conversationId, session);
    this.logicalSessions.delete(conversationId);
    return session;
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
    const active = this.sessions.get(conversationId);
    if (active) return summaryFromSession(active);
    const stored = this.options.state?.getSummary(conversationId);
    if (stored) return stored;
    const existing = this.logicalSessions.get(conversationId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const summary: BotSessionSummary = {
      conversationId,
      name: options.name ?? defaultSessionName(),
      nameSource: options.nameSource ?? "generated",
      source: options.source ?? this.source,
      model: null,
      systemPrompt: null,
      parentSessionId: options.parentSessionId ?? null,
      parentMessageId: options.parentMessageId ?? null,
      tokenTotals: { ...ZERO_TOKENS },
      createdAt: now,
      updatedAt: now,
      expiresAt: this.nextExpiry(),
    };
    this.options.state?.ensureSession({
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
    if (!this.options.state) this.logicalSessions.set(conversationId, summary);
    return summary;
  }

  createSubSession(input: {
    parentSessionId: string;
    parentMessageId?: number | null;
    name?: string;
    source?: string;
  }): BotSessionSummary {
    const id = `sub-${crypto.randomUUID()}`;
    return this.ensureLogicalSession(id, {
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
    const active = this.sessions.get(conversationId);
    if (active) return summaryFromSession(active);
    return this.options.state?.getSummary(conversationId)
      ?? this.logicalSessions.get(conversationId);
  }

  listSessions(): BotSessionSummary[] {
    const byId = new Map<string, BotSessionSummary>();
    for (const summary of this.options.state?.listSessions() ?? []) {
      byId.set(summary.conversationId, summary);
    }
    for (const summary of this.logicalSessions.values()) {
      byId.set(summary.conversationId, summary);
    }
    for (const session of this.sessions.values()) {
      byId.set(session.conversationId, summaryFromSession(session));
    }
    return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getTranscript(conversationId: string): BotMessage[] {
    const active = this.sessions.get(conversationId);
    if (active) return [...active.messages];
    return this.options.state?.loadSession(conversationId)?.messages ?? [];
  }

  messagesPage(conversationId: string, input: { beforeId?: number | null; limit: number }): MessagePage {
    return this.options.state?.messagesPage(conversationId, input)
      ?? { items: [], oldestId: null, newestId: null, hasMoreBefore: false };
  }

  findSessionsByName(name: string): BotSessionSummary[] {
    return this.listSessions().filter((session) => session.name === name);
  }

  renameSession(conversationId: string, name: string): BotSessionSummary | undefined {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Session name cannot be empty");
    const now = new Date().toISOString();
    const active = this.sessions.get(conversationId);
    if (active) {
      active.name = trimmed;
      active.nameSource = "manual";
      active.updatedAt = now;
      this.options.state?.renameSession(conversationId, trimmed);
      return summaryFromSession(active);
    }
    const stored = this.options.state?.getSummary(conversationId);
    if (stored) {
      this.options.state?.renameSession(conversationId, trimmed);
      return this.options.state?.getSummary(conversationId);
    }
    const logical = this.logicalSessions.get(conversationId);
    if (!logical) return undefined;
    const renamed = { ...logical, name: trimmed, nameSource: "manual" as const, updatedAt: now };
    this.logicalSessions.set(conversationId, renamed);
    return renamed;
  }

  appendMessages(conversationId: string, messages: BotMessage[]): void {
    const session = this.sessions.get(conversationId);
    if (!session) {
      if (this.options.state?.getSummary(conversationId)) {
        this.options.state.appendMessages(conversationId, messages);
      }
      return;
    }
    session.messages.push(...messages);
    if (session.messages.length > MAX_CONVERSATION_HISTORY_MESSAGES) {
      session.messages.splice(
        0,
        session.messages.length - MAX_CONVERSATION_HISTORY_MESSAGES,
      );
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
    this.options.state?.appendMessages(conversationId, messages);
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

  async addGlobalMount(
    hostPath: string,
    callerConversationId?: string,
  ): Promise<AddGlobalMountResult> {
    const prepared = prepareGlobalMountAdd(this.globalMounts, hostPath);
    if (!prepared.next) return prepared.result;
    this.globalMounts = prepared.next;
    this.options.persistGlobalMounts?.(prepared.next);
    await this.scheduleMountsRefresh(callerConversationId);
    return prepared.result;
  }

  async refreshMounts(conversationId?: string): Promise<void> {
    if (this.sandboxState !== "live" || !this.sandboxId) return;
    this.options.events.emit({
      type: "sandbox.mountsRefreshing",
      conversationId: conversationId ?? this.botId,
      sessionId: this.sandboxId,
    });
    const sandbox = await this.options.sandbox.recreate(
      this.sandboxId,
      this.workspaceRoot,
      this.mountsForSandbox(),
    );
    this.sandboxId = sandbox.id;
    for (const session of this.sessions.values()) session.sandboxSessionId = sandbox.id;
    this.options.events.emit({
      type: "sandbox.mountsRefreshed",
      conversationId: conversationId ?? this.botId,
      sessionId: sandbox.id,
    });
  }

  refreshAllMounts(): void {
    void this.scheduleMountsRefresh(undefined);
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

  async clear(conversationId: string): Promise<void> {
    const active = this.sessions.get(conversationId);
    if (active) {
      active.messages = [];
      active.tokenTotals = { ...ZERO_TOKENS };
      active.updatedAt = new Date().toISOString();
      await this.destroy(conversationId);
    }
    const now = new Date().toISOString();
    const summary = this.getSummary(conversationId)
      ?? this.ensureLogicalSession(conversationId);
    this.options.state?.clearSession(conversationId, now);
    if (!this.options.state) {
      this.logicalSessions.set(conversationId, {
        ...summary,
        tokenTotals: { ...ZERO_TOKENS },
        updatedAt: now,
      });
    }
  }

  async deleteSession(conversationId: string): Promise<string[]> {
    return deleteSessionTree(this.deleteContext(), conversationId);
  }

  async deleteAllSessions(): Promise<string[]> {
    return deleteEverySession(this.deleteContext());
  }

  async sweepExpired(now = new Date()): Promise<void> {
    const idleMs = this.options.idleParkMs ?? DEFAULT_IDLE_PARK_MS;
    for (const [conversationId, session] of [...this.sessions]) {
      if (session.expiresAt <= now) {
        await this.destroy(conversationId);
      }
    }
    if (this.sandboxState !== "live" || !this.sandboxId) return;
    const liveSessions = [...this.sessions.values()];
    if (liveSessions.length === 0) {
      await this.parkBot();
      return;
    }
    const allIdle = liveSessions.every(
      (s) => now.getTime() - s.lastActivityAt.getTime() > idleMs,
    );
    if (allIdle) await this.parkBot();
  }

  private async parkBot(): Promise<void> {
    if (this.sandboxState !== "live" || !this.sandboxId) return;
    this.sandboxState = "parking";
    try {
      await this.options.sandbox.park(this.sandboxId);
      this.sandboxState = "parked";
      for (const session of this.sessions.values()) session.state = "parked";
    } catch (error) {
      this.sandboxState = "live";
      throw error;
    }
  }

  async replaceSandboxProvider(sandbox: SandboxProvider): Promise<void> {
    if (this.sandboxId && (this.sandboxState === "live" || this.sandboxState === "parked")) {
      try {
        await this.options.sandbox.destroy(this.sandboxId);
      } catch {}
    }
    this.sessions.clear();
    this.sandboxId = null;
    this.sandboxState = "idle";
    this.sandboxReady = null;
    this.options.sandbox = sandbox;
  }

  setTtlMs(ttlMs: number): void {
    this.options.ttlMs = ttlMs;
  }

  setIdleParkMs(idleParkMs: number): void {
    this.options.idleParkMs = idleParkMs;
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

  async parkAll(): Promise<void> {
    try {
      await this.parkBot();
    } catch {}
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
