import {
  DEFAULT_IDLE_PARK_MS,
  DEFAULT_MAX_LIVE_SANDBOXES,
  DEFAULT_SESSION_TTL_MS,
  MAX_CONVERSATION_HISTORY_MESSAGES,
} from "../config/limits";
import type { ActiveRunRegistry } from "../agent/active-runs";
import type { GlobalMount } from "../config/env";
import type { EventBus } from "../events/bus";
import { existsSync } from "node:fs";
import type { SandboxProvider, SessionMount } from "../sandbox/provider";
import { WorkspaceStore } from "../workspace/store";
import {
  defaultSessionName,
  generateSessionName,
  sessionIdFromName,
} from "./session-names";
import { deleteEverySession, deleteSessionTree } from "./delete-sessions";
import { computeMountName, summaryFromSession } from "./session-summary";
export { computeMountName } from "./session-summary";
import type { MessagePage, SessionStateStore } from "./state-store";
import type {
  BotMessage,
  BotSession,
  BotSessionSummary,
  SessionNameSource,
  SessionTokenTotals,
} from "./types";

const ZERO_TOKENS: SessionTokenTotals = { input: 0, output: 0, thought: 0, total: 0 };

export interface AddGlobalMountResult {
  alreadyExisted: boolean;
  mount: SessionMount;
  sandboxPath: string;
}

export class SessionManager {
  private readonly sessions = new Map<string, BotSession>();
  private readonly logicalSessions = new Map<string, BotSessionSummary>();
  private readonly source: string;
  private globalMounts: GlobalMount[] = [];

  constructor(
    private readonly options: {
      sandbox: SandboxProvider;
      workspaces: WorkspaceStore;
      events: EventBus;
      ttlMs?: number;
      idleParkMs?: number;
      maxLiveSandboxes?: number;
      state?: SessionStateStore;
      source?: string;
      activeRuns?: ActiveRunRegistry;
      /** Persist new globalMounts back to settings storage. Owned by runtime. */
      persistGlobalMounts?: (mounts: GlobalMount[]) => void;
      globalMounts?: GlobalMount[];
    }
  ) {
    this.source = options.source ?? "unknown";
    this.globalMounts = options.globalMounts ?? [];
  }

  async get(
    conversationId: string,
    options: { name?: string; nameSource?: SessionNameSource } = {},
  ): Promise<BotSession> {
    const existing = this.sessions.get(conversationId);
    if (existing && existing.expiresAt > new Date()) {
      if (existing.state === "parked") {
        await this.evictLruIfNeeded(conversationId);
        await this.options.sandbox.resume(existing.sandboxSessionId);
        existing.state = "live";
      }
      existing.expiresAt = this.nextExpiry();
      existing.lastActivityAt = new Date();
      existing.updatedAt = existing.lastActivityAt.toISOString();
      return existing;
    }

    if (existing) await this.destroy(conversationId);
    await this.evictLruIfNeeded(conversationId);
    const stored = this.options.state?.loadSession(conversationId);
    const logical = this.logicalSessions.get(conversationId);
    const workspacePath = await this.options.workspaces.initConversation(conversationId);
    const mounts = this.mountsForSandbox();
    const sandbox = await this.options.sandbox.createSession(conversationId, workspacePath, mounts);
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
      sandboxSessionId: sandbox.id,
      messages: stored?.messages ?? [],
      workspacePath,
      expiresAt: this.nextExpiry(),
      lastActivityAt: nowDate,
      state: "live",
    };
    this.ensureLogicalSession(conversationId, { name: session.name, nameSource: session.nameSource });
    this.sessions.set(conversationId, session);
    this.logicalSessions.delete(conversationId);
    this.options.events.emit({ type: "sandbox.created", conversationId, sessionId: sandbox.id });
    return session;
  }

  ensureLogicalSession(
    conversationId: string,
    options: {
      name?: string;
      nameSource?: SessionNameSource;
      parentSessionId?: string | null;
      parentMessageId?: number | null;
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
      source: this.source,
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
    if (!session) return;
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
    const out: SessionMount[] = [];
    const seen = new Set<string>();
    for (const m of this.globalMounts) {
      if (seen.has(m.hostPath)) continue;
      seen.add(m.hostPath);
      if (!existsSync(m.hostPath)) continue;
      out.push({ hostPath: m.hostPath, mountName: computeMountName(m.hostPath) });
    }
    return out;
  }

  async addGlobalMount(
    hostPath: string,
    callerConversationId?: string,
  ): Promise<AddGlobalMountResult> {
    const mountName = computeMountName(hostPath);
    const sandboxPath = `/workspace/mounts/${mountName}`;
    const existing = this.globalMounts.find((m) => m.hostPath === hostPath);
    if (existing) {
      return {
        alreadyExisted: true,
        mount: { hostPath, mountName },
        sandboxPath,
      };
    }
    const next = [...this.globalMounts, { hostPath }];
    this.globalMounts = next;
    this.options.persistGlobalMounts?.(next);
    await this.scheduleMountsRefresh(callerConversationId);
    return {
      alreadyExisted: false,
      mount: { hostPath, mountName },
      sandboxPath,
    };
  }

  async refreshMounts(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session || session.state !== "live") return;
    const sandbox = await this.options.sandbox.recreate(
      session.sandboxSessionId,
      session.workspacePath,
      this.mountsForSandbox(),
    );
    if (sandbox.id !== session.sandboxSessionId) {
      session.sandboxSessionId = sandbox.id;
    }
    this.options.events.emit({
      type: "sandbox.mountsRefreshed",
      conversationId,
      sessionId: sandbox.id,
    });
  }

  refreshAllMounts(): void {
    void this.scheduleMountsRefresh(undefined);
  }

  private async scheduleMountsRefresh(
    callerConversationId?: string,
  ): Promise<void> {
    const activeRuns = this.options.activeRuns;
    const tasks: Promise<void>[] = [];
    for (const [id, session] of this.sessions) {
      if (session.state !== "live") continue;
      if (id === callerConversationId) {
        tasks.push(this.refreshMounts(id));
        continue;
      }
      if (activeRuns && activeRuns.isActive(id)) {
        this.options.events.emit({
          type: "sandbox.mountsRefreshPending",
          conversationId: id,
        });
        activeRuns.onIdle(id, () => this.refreshMounts(id));
      } else {
        tasks.push(this.refreshMounts(id));
      }
    }
    await Promise.all(tasks);
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
    for (const [conversationId, session] of this.sessions) {
      if (session.expiresAt <= now) {
        await this.destroy(conversationId);
        continue;
      }
      if (
        session.state === "live"
        && now.getTime() - session.lastActivityAt.getTime() > idleMs
      ) {
        await this.parkSession(conversationId);
      }
    }
  }

  private async parkSession(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session || session.state === "parked") return;
    await this.options.sandbox.park(session.sandboxSessionId);
    session.state = "parked";
  }

  private async evictLruIfNeeded(excludeId: string): Promise<void> {
    const cap = this.options.maxLiveSandboxes ?? DEFAULT_MAX_LIVE_SANDBOXES;
    if (cap <= 0) return;
    const liveOthers = [...this.sessions.values()]
      .filter((s) => s.state === "live" && s.conversationId !== excludeId);
    if (liveOthers.length < cap) return;
    liveOthers.sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime());
    const toEvict = liveOthers.slice(0, liveOthers.length - cap + 1);
    for (const victim of toEvict) {
      await this.parkSession(victim.conversationId);
    }
  }

  async replaceSandboxProvider(sandbox: SandboxProvider): Promise<void> {
    for (const conversationId of [...this.sessions.keys()]) {
      await this.destroy(conversationId);
    }
    this.options.sandbox = sandbox;
  }

  setTtlMs(ttlMs: number): void {
    this.options.ttlMs = ttlMs;
  }

  setIdleParkMs(idleParkMs: number): void {
    this.options.idleParkMs = idleParkMs;
  }

  setMaxLiveSandboxes(maxLiveSandboxes: number): void {
    this.options.maxLiveSandboxes = maxLiveSandboxes;
  }

  async destroy(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    this.sessions.delete(conversationId);
    await this.options.sandbox.destroy(session.sandboxSessionId);
    this.options.events.emit({
      type: "sandbox.destroyed",
      conversationId,
      sessionId: session.sandboxSessionId
    });
  }

  closeState(): void {
    this.options.state?.close?.();
  }

  async parkAll(): Promise<void> {
    for (const conversationId of [...this.sessions.keys()]) {
      try {
        await this.parkSession(conversationId);
      } catch {
        // Best-effort during shutdown.
      }
    }
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
