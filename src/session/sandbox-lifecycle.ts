import { DEFAULT_IDLE_PARK_MS } from "../config/limits";
import type { EventBus } from "../events/bus";
import type { SandboxProvider, SessionMount } from "../sandbox/provider";
import type { BotSession } from "./types";

type SandboxState = "idle" | "starting" | "live" | "parking" | "parked" | "resuming";

export class SandboxLifecycle {
  private state: SandboxState = "idle";
  private id: string | null = null;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly input: {
      sandbox: SandboxProvider;
      botId: string;
      workspaceRoot: string;
      outboxRoot: string;
      events: EventBus;
      sessions: Map<string, BotSession>;
      idleParkMs?: number;
      mountsForSandbox: () => SessionMount[];
    },
  ) {}

  get sandboxId(): string | null {
    return this.id;
  }

  async ensureBotSandbox(): Promise<string> {
    if (this.state === "live" && this.id) return this.id;
    if (this.ready) await this.ready;
    else {
      this.ready = this.bringLive().finally(() => {
        this.ready = null;
      });
      await this.ready;
    }
    if (!this.id) throw new Error(`Sandbox in unexpected state: ${this.state}`);
    return this.id;
  }

  async refreshMounts(conversationId?: string): Promise<void> {
    if (this.state !== "live" || !this.id) return;
    this.input.events.emit({
      type: "sandbox.mountsRefreshing",
      conversationId: conversationId ?? this.input.botId,
      sessionId: this.id,
    });
    const sandbox = await this.input.sandbox.recreate(
      this.id,
      this.input.workspaceRoot,
      this.input.outboxRoot,
      this.input.mountsForSandbox(),
    );
    this.id = sandbox.id;
    for (const session of this.input.sessions.values()) session.sandboxSessionId = sandbox.id;
    this.input.events.emit({
      type: "sandbox.mountsRefreshed",
      conversationId: conversationId ?? this.input.botId,
      sessionId: sandbox.id,
    });
  }

  async sweepExpired(now = new Date()): Promise<void> {
    const idleMs = this.input.idleParkMs ?? DEFAULT_IDLE_PARK_MS;
    if (this.state !== "live" || !this.id) return;
    const liveSessions = [...this.input.sessions.values()];
    if (liveSessions.length === 0) {
      await this.parkBot();
      return;
    }
    const allIdle = liveSessions.every((s) => now.getTime() - s.lastActivityAt.getTime() > idleMs);
    if (allIdle) await this.parkBot();
  }

  async replaceProvider(sandbox: SandboxProvider): Promise<void> {
    if (this.id && (this.state === "live" || this.state === "parked")) {
      try {
        await this.input.sandbox.destroy(this.id);
      } catch {}
    }
    this.input.sandbox = sandbox;
    this.input.sessions.clear();
    this.id = null;
    this.state = "idle";
    this.ready = null;
  }

  setIdleParkMs(idleParkMs: number): void {
    this.input.idleParkMs = idleParkMs;
  }

  async parkAll(): Promise<void> {
    try {
      await this.parkBot();
    } catch {}
  }

  private async bringLive(): Promise<void> {
    if (this.state === "idle") {
      await this.startNew();
      return;
    }
    if (this.state === "parked" && this.id) {
      await this.resume();
      return;
    }
    if (!this.id) throw new Error(`Sandbox in unexpected state: ${this.state}`);
  }

  private async startNew(): Promise<void> {
    this.state = "starting";
    this.input.events.emit({ type: "sandbox.starting", conversationId: this.input.botId });
    try {
      const sandbox = await this.input.sandbox.createSession(
        this.input.botId,
        this.input.workspaceRoot,
        this.input.outboxRoot,
        this.input.mountsForSandbox(),
      );
      this.id = sandbox.id;
      this.state = "live";
      this.input.events.emit({ type: "sandbox.created", conversationId: this.input.botId, sessionId: sandbox.id });
    } catch (error) {
      this.state = "idle";
      this.id = null;
      throw error;
    }
  }

  private async resume(): Promise<void> {
    this.state = "resuming";
    this.input.events.emit({ type: "sandbox.resuming", conversationId: this.input.botId, sessionId: this.id! });
    try {
      await this.input.sandbox.resume(this.id!);
      this.state = "live";
      this.input.events.emit({ type: "sandbox.created", conversationId: this.input.botId, sessionId: this.id! });
    } catch (error) {
      this.state = "parked";
      throw error;
    }
  }

  private async parkBot(): Promise<void> {
    if (this.state !== "live" || !this.id) return;
    this.state = "parking";
    try {
      await this.input.sandbox.park(this.id);
      this.state = "parked";
      for (const session of this.input.sessions.values()) session.state = "parked";
    } catch (error) {
      this.state = "live";
      throw error;
    }
  }
}
