import { SqliteSessionStateStore } from "../../../session/sqlite-state-store";
import type { BotMessage } from "../../../session/types";
import { RuntimeStore, type RuntimeCommandRow } from "../../runtime-store";
import { RuntimeLogRateLimiter } from "../../log-rate-limit";
import { commandError, type CommandCompletion, type RuntimeQueueStatus, type RuntimeServiceRole, type RuntimeServiceStatus } from "../../protocol/types";
import type { RuntimeBusClientFrame, RuntimeBusRequest, RuntimeBusServerFrame } from "../../protocol/bus";
import { loadBaseConfig } from "../../resolve-effective-config";
import { QueueSessionCache } from "./session-cache";
import type { WebLiveEvent } from "../../../web/live-events";

const CHAT_QUEUE_ID = "agent.chat";
const BASE_CHAT_DEPENDENCIES: RuntimeServiceRole[] = ["sandbox-worker"];

type RuntimeSocket = Bun.ServerWebSocket<{ role?: RuntimeServiceRole }>;

interface PendingWaiter {
  resolve: (completion: CommandCompletion) => void;
  timer: Timer;
}

export class QueueServiceRuntime {
  private readonly sockets = new Set<RuntimeSocket>();
  private readonly workers = new Map<RuntimeServiceRole, RuntimeSocket>();
  private readonly services = new Map<RuntimeServiceRole, RuntimeServiceStatus>();
  private readonly queues = new Map<string, RuntimeQueueStatus>();
  private readonly pendingCommands = new Map<string, RuntimeCommandRow>();
  private readonly waiters = new Map<string, PendingWaiter>();
  private readonly logRateLimiter = new RuntimeLogRateLimiter();
  private lastChatQueueStatusKey = "";
  private server?: Bun.Server<{ role?: RuntimeServiceRole }>;

  private constructor(
    private readonly runtimeStore: RuntimeStore,
    private readonly sessions: QueueSessionCache,
    private readonly token: string,
    private readonly port: number,
  ) {}

  static create(): QueueServiceRuntime {
    const config = loadBaseConfig();
    const runtimeStore = new RuntimeStore(config.stateDbPath);
    let runtime: QueueServiceRuntime;
    const sessions = new QueueSessionCache(
      new SqliteSessionStateStore(config.stateDbPath),
      (event) => runtime.publish(event),
    );
    runtime = new QueueServiceRuntime(
      runtimeStore,
      sessions,
      requiredEnv("AITHY_QUEUE_TOKEN"),
      Number(requiredEnv("AITHY_QUEUE_PORT")),
    );
    for (const command of runtimeStore.unfinishedCommands()) {
      if (command.status === "claimed") {
        runtimeStore.completeCommand(command.id, "failed", {
          ok: false,
          error: "Runtime command was interrupted by queue-service restart",
        });
      } else {
        runtime.pendingCommands.set(command.id, command);
      }
    }
    return runtime;
  }

  start(): void {
    this.server = Bun.serve<{ role?: RuntimeServiceRole }>({
      hostname: "127.0.0.1",
      port: this.port,
      fetch: (request, server) => this.fetch(request, server),
      websocket: {
        open: (ws) => {
          this.sockets.add(ws);
        },
        message: (ws, message) => void this.receive(ws, message),
        close: (ws) => this.closeSocket(ws),
      },
    });
    this.setService("queue-service", "ready", { port: this.server.port }, process.pid);
    this.publishLog({ role: "queue-service", level: "info", source: "startup", message: `queue-service ready on ${this.server.port}` });
    console.log(`[queue-service] ready ${JSON.stringify({ url: this.url(), port: this.server.port })}`);
  }

  url(): string {
    return `ws://127.0.0.1:${this.server?.port ?? this.port}/runtime?token=${encodeURIComponent(this.token)}`;
  }

  stop(): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve({ ok: false, error: "queue-service stopped" });
    }
    this.waiters.clear();
    this.server?.stop(true);
    this.sessions.close();
    this.runtimeStore.close();
  }

  private fetch(request: Request, server: Bun.Server<{ role?: RuntimeServiceRole }>): Response | undefined {
    const url = new URL(request.url);
    if (url.searchParams.get("token") !== this.token) return new Response("unauthorized", { status: 401 });
    if (url.pathname === "/health") return Response.json({ ok: true, role: "queue-service" });
    if (url.pathname === "/runtime" && server.upgrade(request, { data: {} })) return undefined;
    return new Response("not found", { status: 404 });
  }

  private async receive(ws: RuntimeSocket, message: string | Buffer): Promise<void> {
    const frame = JSON.parse(String(message)) as RuntimeBusClientFrame;
    if (frame.type === "hello") {
      ws.data.role = frame.role;
      if (frame.role !== "web" && frame.role !== "queue-service") this.workers.set(frame.role, ws);
      this.setService(frame.role, "starting", { connected: true }, frame.pid);
      this.dispatchAll();
      return;
    }
    const request = frame as RuntimeBusRequest;
    try {
      const result = await this.handleRequest(request);
      this.send(ws, { id: request.id, type: "response", ok: true, result });
    } catch (error) {
      this.send(ws, { id: request.id, type: "response", ok: false, error: commandError(error) });
    }
  }

  private async handleRequest(request: RuntimeBusRequest): Promise<unknown> {
    switch (request.method) {
      case "runtime.command.submit":
        return { commandId: this.enqueueCommand(request.params.targetRole, request.params.kind, request.params.payload) };
      case "runtime.command.invoke":
        return this.invokeCommand(request.params.targetRole, request.params.kind, request.params.payload, request.params.timeoutMs);
      case "runtime.command.complete":
        this.completeCommand(request.params.commandId, request.params.completion);
        return { ok: true };
      case "runtime.log":
        this.publishLog(request.params);
        return { ok: true };
      case "runtime.event":
        this.publish(request.params.event);
        return { ok: true };
      case "runtime.queueStatus":
        this.setQueue(request.params.queue);
        return { ok: true };
      case "runtime.serviceStatus":
        this.setService(request.params.role, request.params.state, request.params.detail, request.params.pid ?? null);
        return { ok: true };
      case "runtime.service":
        return this.services.get(request.params.role) ?? null;
      case "runtime.services":
        return [...this.services.values()];
      case "runtime.consoleSnapshot":
        return this.consoleSnapshot(request.params.logLimit, request.params.commandLimit);
      case "session.ensure":
        return this.sessions.ensure(reviveLogicalInput(request.params));
      case "session.load":
        return this.sessions.load(request.params.conversationId);
      case "session.list":
        return this.sessions.list();
      case "session.findByName":
        return this.sessions.findByName(request.params.name);
      case "session.summary":
        return this.sessions.summary(request.params.conversationId);
      case "session.rename":
        return this.sessions.rename(request.params.conversationId, request.params.name);
      case "session.clear":
        return this.sessions.clear(request.params.conversationId, request.params.now);
      case "session.delete":
        this.sessions.delete(request.params.conversationId);
        return { ok: true };
      case "session.deleteAll":
        this.sessions.deleteAll();
        return { ok: true };
      case "session.appendMessages":
        return this.sessions.appendMessages(request.params.conversationId, request.params.messages as BotMessage[]);
      case "session.messagesPage":
        return this.sessions.messagesPage(request.params.conversationId, request.params.input);
      case "session.messagesByIdRange":
        return this.sessions.messagesByIdRange(request.params.conversationId, request.params.input);
      case "session.childSessions":
        return this.sessions.childSessions(request.params.parentId);
      case "session.lastMessageId":
        return this.sessions.lastMessageId(request.params.conversationId);
    }
  }

  private enqueueCommand(targetRole: RuntimeServiceRole, kind: string, payload: unknown = {}): string {
    const id = this.runtimeStore.enqueueCommand(targetRole, kind, payload);
    const row = this.runtimeStore.commandById(id);
    if (row) this.pendingCommands.set(id, row);
    this.dispatchAll();
    this.publishChatQueueStatus();
    return id;
  }

  private async invokeCommand(
    targetRole: RuntimeServiceRole,
    kind: string,
    payload: unknown = {},
    timeoutMs = 60_000,
  ): Promise<CommandCompletion> {
    const commandId = this.enqueueCommand(targetRole, kind, payload);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(commandId);
        resolve({ ok: false, error: `Runtime command timed out after ${timeoutMs}ms: ${commandId}` });
      }, timeoutMs);
      timer.unref();
      this.waiters.set(commandId, { resolve, timer });
    });
  }

  private completeCommand(commandId: string, completion: CommandCompletion): void {
    this.pendingCommands.delete(commandId);
    this.runtimeStore.completeCommand(commandId, completion.ok ? "completed" : "failed", completion);
    const waiter = this.waiters.get(commandId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(commandId);
      waiter.resolve(completion);
    }
    this.dispatchAll();
    this.publishChatQueueStatus();
  }

  private dispatchAll(): void {
    for (const command of [...this.pendingCommands.values()]) this.dispatch(command);
  }

  private dispatch(command: RuntimeCommandRow): void {
    if (command.status !== "pending") return;
    if (!this.canDispatch(command)) return;
    const worker = this.workers.get(command.targetRole);
    if (!worker) return;
    const claimed = this.runtimeStore.claimCommand(command.id);
    if (!claimed || claimed.status !== "claimed") return;
    this.pendingCommands.set(command.id, claimed);
    this.send(worker, { type: "command.dispatch", command: claimed });
  }

  private canDispatch(command: RuntimeCommandRow): boolean {
    if (command.targetRole !== "agent-worker" || command.kind !== "enqueue_user_chat") return true;
    return this.chatDependencies().every((role) => this.services.get(role)?.state === "ready");
  }

  private setService(
    role: RuntimeServiceRole,
    state: RuntimeServiceStatus["state"],
    detail?: unknown,
    pid: number | null = null,
  ): void {
    const previous = this.services.get(role);
    const status = {
      role,
      state,
      pid,
      detail: detail ?? null,
      lastSeenAt: new Date().toISOString(),
    };
    this.services.set(role, status);
    this.runtimeStore.heartbeat(role, state, detail, { emitEvent: false, pid });
    if (previous && sameServiceStatus(previous, status)) return;
    this.publish({
      type: "service-status",
      id: crypto.randomUUID(),
      createdAt: status.lastSeenAt,
      ...status,
    });
    this.dispatchAll();
    this.publishChatQueueStatus();
  }

  private publishLog(input: Parameters<RuntimeStore["appendLog"]>[0]): void {
    if (!this.logRateLimiter.shouldPublish(input)) return;
    const createdAt = new Date().toISOString();
    const event: WebLiveEvent = { type: "log", id: crypto.randomUUID(), createdAt, ...input };
    this.runtimeStore.appendLog(input);
    this.broadcast({ type: "event", event });
  }

  private setQueue(queue: RuntimeQueueStatus): void {
    this.queues.set(queue.id, queue);
    this.runtimeStore.appendQueueStatus(queue);
    this.publish({ type: "queue-status", id: crypto.randomUUID(), createdAt: new Date().toISOString(), queue });
  }

  private publish(event: WebLiveEvent): void {
    this.runtimeStore.appendEvent(event);
    this.broadcast({ type: "event", event });
  }

  private consoleSnapshot(logLimit = 120, commandLimit = 120) {
    const queueById = new Map(this.queues);
    for (const row of this.runtimeStore.recentEvents({ kinds: ["queue-status"], limit: 100 })) {
      if (row.payload.type === "queue-status" && !queueById.has(row.payload.queue.id)) {
        queueById.set(row.payload.queue.id, row.payload.queue);
      }
    }
    return {
      services: [...this.services.values()],
      setupStatuses: this.recentSetupStatuses(),
      logs: this.runtimeStore.recentEvents({ kinds: ["log"], limit: logLimit }).map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        event: row.payload,
      })),
      commands: this.runtimeStore.recentCommands(commandLimit),
      queues: [...queueById.values()],
    };
  }

  private recentSetupStatuses(): Array<WebLiveEvent & { type: "setup-status" }> {
    const latest = new Map<string, WebLiveEvent & { type: "setup-status" }>();
    const rows = this.runtimeStore.recentEvents({ kinds: ["setup-status"], limit: 100 }).reverse();
    for (const row of rows) {
      const event = row.payload;
      if (event.type !== "setup-status") continue;
      if (event.active || event.tone === "danger") latest.set(event.key, event);
      else latest.delete(event.key);
    }
    return [...latest.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private publishChatQueueStatus(): void {
    const blockedReason = this.chatBlockedReason();
    const dependencies = this.chatDependencies();
    const chatCommands = [...this.pendingCommands.values()]
      .filter((command) => command.targetRole === "agent-worker" && command.kind === "enqueue_user_chat");
    const activeCount = chatCommands.filter((command) => command.status === "claimed").length;
    const depth = chatCommands.length - activeCount;
    const state = blockedReason ? "blocked" : activeCount > 0 ? "running" : depth > 0 ? "running" : "idle";
    const statusKey = JSON.stringify({ state, depth, activeCount, blockedReason });
    if (statusKey === this.lastChatQueueStatusKey) return;
    this.lastChatQueueStatusKey = statusKey;
    this.setQueue({
      id: CHAT_QUEUE_ID,
      ownerRole: "queue-service",
      state,
      depth,
      activeCount,
      blockedReason,
      dependencyRoles: dependencies,
      updatedAt: new Date().toISOString(),
    });
  }

  private chatBlockedReason(): string | undefined {
    const waiting = this.chatDependencies().flatMap((role) => {
      const service = this.services.get(role);
      return service?.state === "ready" ? [] : [`${role}: ${service?.state ?? "unknown"}`];
    });
    return waiting.length === 0 ? undefined : `waiting for ${waiting.join(", ")}`;
  }

  private chatDependencies(): RuntimeServiceRole[] {
    return chatDependenciesForServices(this.services);
  }

  private closeSocket(ws: RuntimeSocket): void {
    this.sockets.delete(ws);
    if (ws.data.role && this.workers.get(ws.data.role) === ws) {
      this.workers.delete(ws.data.role);
      if (ws.data.role !== "web") this.setService(ws.data.role, "failed", { disconnected: true });
    }
  }

  private broadcast(frame: RuntimeBusServerFrame): void {
    for (const socket of this.sockets) this.send(socket, frame);
  }

  private send(ws: RuntimeSocket, frame: RuntimeBusServerFrame): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(frame));
  }
}

function sameServiceStatus(a: RuntimeServiceStatus, b: RuntimeServiceStatus): boolean {
  return a.role === b.role
    && a.state === b.state
    && a.pid === b.pid
    && JSON.stringify(a.detail ?? null) === JSON.stringify(b.detail ?? null);
}

export function chatDependenciesForServices(
  services: ReadonlyMap<RuntimeServiceRole, RuntimeServiceStatus>,
): RuntimeServiceRole[] {
  const dependencies = [...BASE_CHAT_DEPENDENCIES];
  if (localInferenceRequiredForServices(services)) dependencies.push("local-inference-worker");
  return dependencies;
}

function localInferenceRequiredForServices(
  services: ReadonlyMap<RuntimeServiceRole, RuntimeServiceStatus>,
): boolean {
  const detail = services.get("local-inference-worker")?.detail;
  if (!detail || typeof detail !== "object") return false;
  return (detail as Record<string, unknown>).required === true;
}

function reviveLogicalInput(input: unknown): Parameters<QueueSessionCache["ensure"]>[0] {
  const value = input as Parameters<QueueSessionCache["ensure"]>[0] & { expiresAt: string | Date };
  return { ...value, expiresAt: new Date(value.expiresAt) };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
