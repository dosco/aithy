import type { BotMessage, BotSessionSummary } from "../../../session/types";
import type { LogicalSessionInput, MessagePage, MessagePageInput, StoredSession } from "../../../session/state-store";
import type { WebLiveEvent } from "../../../web/live-events";
import type {
  CommandCompletion,
  RuntimeLogEventPayload,
  RuntimeQueueStatus,
  RuntimeServiceRole,
  RuntimeServiceState,
  RuntimeServiceStatus,
} from "../../protocol/types";
import type {
  RuntimeBusClientFrame,
  RuntimeBusMethod,
  RuntimeBusResponse,
  RuntimeBusServerFrame,
  RuntimeConsoleSnapshot,
} from "../../protocol/bus";
import { RuntimeCommandError } from "../../protocol/command-client";
import type { RuntimeCommandRow } from "../../runtime-store";

type EventListener = (event: WebLiveEvent) => void;
type CommandHandler = (command: RuntimeCommandRow) => Promise<unknown>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class QueueServiceClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly serviceCache = new Map<RuntimeServiceRole, RuntimeServiceStatus>();
  private commandHandler?: CommandHandler;

  private constructor(
    private readonly socket: WebSocket,
    public readonly role: RuntimeServiceRole,
  ) {}

  static async connect(input: { url: string; role: RuntimeServiceRole }): Promise<QueueServiceClient> {
    const socket = new WebSocket(input.url);
    const client = new QueueServiceClient(socket, input.role);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("Failed to connect to queue-service"));
    });
    socket.onmessage = (message) => void client.receive(message.data);
    socket.onclose = () => client.rejectAll("queue-service connection closed");
    client.send({ type: "hello", role: input.role, pid: process.pid, instanceId: crypto.randomUUID() });
    return client;
  }

  subscribe(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  close(): void {
    this.socket.close();
  }

  async submitCommand(targetRole: RuntimeServiceRole, kind: string, payload: unknown = {}): Promise<string> {
    const result = await this.request("runtime.command.submit", { targetRole, kind, payload }) as { commandId: string };
    return result.commandId;
  }

  async invokeCommand<T>(targetRole: RuntimeServiceRole, kind: string, payload: unknown = {}, timeoutMs?: number): Promise<T> {
    const completion = await this.request("runtime.command.invoke", {
      targetRole,
      kind,
      payload,
      timeoutMs,
    }) as CommandCompletion<T>;
    if (!completion.ok) throw new RuntimeCommandError(completion.error, { commandId: "", targetRole });
    return completion.result;
  }

  async completeCommand(commandId: string, completion: CommandCompletion): Promise<void> {
    await this.request("runtime.command.complete", { commandId, completion });
  }

  async appendLog(input: RuntimeLogEventPayload): Promise<void> {
    await this.request("runtime.log", input);
  }

  async appendEvent(event: WebLiveEvent): Promise<void> {
    await this.request("runtime.event", { event });
  }

  async appendQueueStatus(queue: RuntimeQueueStatus): Promise<void> {
    await this.request("runtime.queueStatus", { queue });
  }

  async heartbeat(role: RuntimeServiceRole, state: RuntimeServiceState, detail?: unknown): Promise<void> {
    await this.request("runtime.serviceStatus", { role, state, detail, pid: process.pid });
  }

  async service(role: RuntimeServiceRole): Promise<RuntimeServiceStatus | null> {
    const service = await this.request("runtime.service", { role }) as RuntimeServiceStatus | null;
    if (service) this.serviceCache.set(role, reviveService(service));
    return service ? reviveService(service) : null;
  }

  serviceSync(role: RuntimeServiceRole): RuntimeServiceStatus | null {
    return this.serviceCache.get(role) ?? null;
  }

  async services(): Promise<RuntimeServiceStatus[]> {
    const services = await this.request("runtime.services", {}) as RuntimeServiceStatus[];
    for (const service of services) this.serviceCache.set(service.role, reviveService(service));
    return services.map(reviveService);
  }

  async consoleSnapshot(input: { logLimit?: number; commandLimit?: number } = {}): Promise<RuntimeConsoleSnapshot> {
    return this.request("runtime.consoleSnapshot", input) as Promise<RuntimeConsoleSnapshot>;
  }

  async ensureSession(input: LogicalSessionInput): Promise<BotSessionSummary> {
    return reviveSummary(await this.request("session.ensure", input) as BotSessionSummary);
  }

  async loadSession(conversationId: string): Promise<StoredSession | undefined> {
    const result = await this.request("session.load", { conversationId }) as StoredSession | undefined;
    return result ? reviveStoredSession(result) : undefined;
  }

  async listSessions(): Promise<BotSessionSummary[]> {
    const result = await this.request("session.list", {}) as BotSessionSummary[];
    return result.map(reviveSummary);
  }

  async findSessionsByName(name: string): Promise<BotSessionSummary[]> {
    const result = await this.request("session.findByName", { name }) as BotSessionSummary[];
    return result.map(reviveSummary);
  }

  async sessionSummary(conversationId: string): Promise<BotSessionSummary | undefined> {
    const result = await this.request("session.summary", { conversationId }) as BotSessionSummary | undefined;
    return result ? reviveSummary(result) : undefined;
  }

  async renameSession(conversationId: string, name: string): Promise<BotSessionSummary | undefined> {
    const result = await this.request("session.rename", { conversationId, name }) as BotSessionSummary | undefined;
    return result ? reviveSummary(result) : undefined;
  }

  async clearSession(conversationId: string, now: string): Promise<BotSessionSummary> {
    return reviveSummary(await this.request("session.clear", { conversationId, now }) as BotSessionSummary);
  }

  async deleteSession(conversationId: string): Promise<void> {
    await this.request("session.delete", { conversationId });
  }

  async deleteAllSessions(): Promise<void> {
    await this.request("session.deleteAll", {});
  }

  async appendMessages(conversationId: string, messages: BotMessage[]): Promise<MessagePage> {
    return reviveMessagePage(await this.request("session.appendMessages", { conversationId, messages }) as MessagePage);
  }

  async messagesPage(conversationId: string, input: MessagePageInput): Promise<MessagePage> {
    return reviveMessagePage(await this.request("session.messagesPage", { conversationId, input }) as MessagePage);
  }

  async childSessions(parentId: string): Promise<BotSessionSummary[]> {
    const result = await this.request("session.childSessions", { parentId }) as BotSessionSummary[];
    return result.map(reviveSummary);
  }

  async lastMessageId(conversationId: string): Promise<number | null> {
    return this.request("session.lastMessageId", { conversationId }) as Promise<number | null>;
  }

  private request(method: RuntimeBusMethod, params: unknown): Promise<unknown> {
    const id = crypto.randomUUID();
    this.send({ id, type: "request", method, params } as RuntimeBusClientFrame);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private async receive(data: unknown): Promise<void> {
    const frame = JSON.parse(String(data)) as RuntimeBusServerFrame;
    if (frame.type === "response") {
      this.handleResponse(frame);
      return;
    }
    if (frame.type === "event") {
      this.rememberEvent(frame.event);
      for (const listener of this.eventListeners) listener(frame.event);
      return;
    }
    if (frame.type === "command.dispatch") {
      await this.handleCommand(frame.command);
    }
  }

  private handleResponse(frame: RuntimeBusResponse): void {
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    if (frame.ok) pending.resolve(frame.result);
    else pending.reject(new Error(frame.error));
  }

  private async handleCommand(command: RuntimeCommandRow): Promise<void> {
    if (!this.commandHandler) {
      await this.completeCommand(command.id, { ok: false, error: `No handler for ${this.role}` });
      return;
    }
    try {
      const result = await this.commandHandler(command);
      await this.completeCommand(command.id, { ok: true, result });
    } catch (error) {
      await this.completeCommand(command.id, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private rememberEvent(event: WebLiveEvent): void {
    if (event.type === "service-status") this.serviceCache.set(event.role, reviveService(event));
  }

  private rejectAll(message: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(new Error(message));
    }
  }

  private send(frame: RuntimeBusClientFrame): void {
    this.socket.send(JSON.stringify(frame));
  }
}

function reviveService(service: RuntimeServiceStatus): RuntimeServiceStatus {
  return { ...service };
}

function reviveStoredSession(session: StoredSession): StoredSession {
  return { ...reviveSummary(session), messages: session.messages };
}

function reviveSummary(summary: BotSessionSummary): BotSessionSummary {
  return { ...summary, expiresAt: new Date(summary.expiresAt) };
}

function reviveMessagePage(page: MessagePage): MessagePage {
  return page;
}
