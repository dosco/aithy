import type { BotEvent } from "../events/types";
import type {
  RuntimeLogEventPayload,
  RuntimeQueueStatus,
  RuntimeServiceStatus,
} from "../runtime/protocol/types";
import type { BotMessage, BotSessionSummary } from "../session/types";
import type { SetupStatusInput, SetupStatusTone } from "../setup/status";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SerializableBotMessage =
  | { role: "user"; content: string; createdAt: string }
  | {
      role: "assistant";
      kind: "text";
      content: string;
      thought?: string;
      usage?: { input: number; output: number; thought: number; total: number };
      createdAt: string;
    }
  | {
      role: "assistant";
      kind: "tool_call";
      toolName: string;
      toolArgs: JsonValue;
      toolResult?: JsonValue;
      thought?: string;
      usage?: { input: number; output: number; thought: number; total: number };
      createdAt: string;
    };

export interface SerializableSessionSummary {
  conversationId: string;
  name: string;
  nameSource: "generated" | "manual";
  source: string;
  model: string | null;
  systemPrompt: string | null;
  parentSessionId: string | null;
  parentMessageId: number | null;
  tokenTotals: { input: number; output: number; thought: number; total: number };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type WebLiveEvent =
  | {
      type: "activity";
      id: string;
      conversationId: string;
      createdAt: string;
      streamId?: string;
      label: string;
      detail?: unknown;
      tone?: "neutral" | "danger" | "success";
    }
  | ({
      type: "setup-status";
      id: string;
      createdAt: string;
      streamId?: string;
    } & SetupStatusInput & { tone?: SetupStatusTone })
  | {
      type: "message";
      id: string;
      conversationId: string;
      createdAt: string;
      streamId?: string;
      message: SerializableBotMessage;
    }
  | {
      type: "sessions";
      id: string;
      createdAt: string;
      streamId?: string;
      sessions: SerializableSessionSummary[];
    }
  | {
      type: "notification";
      id: string;
      createdAt: string;
      streamId?: string;
      notification: {
        id: number;
        kind: string;
        title: string;
        body: string | null;
        link: string | null;
        createdAt: string;
      };
    }
  | ({
      type: "log";
      id: string;
      createdAt: string;
      streamId?: string;
    } & RuntimeLogEventPayload)
  | ({
      type: "service-status";
      id: string;
      createdAt: string;
      streamId?: string;
    } & RuntimeServiceStatus)
  | {
      type: "queue-status";
      id: string;
      createdAt: string;
      streamId?: string;
      queue: RuntimeQueueStatus;
    };

type Listener = (event: WebLiveEvent) => void;

export class LiveEventHub {
  private readonly listeners = new Set<Listener>();
  private readonly setupStatuses = new Map<string, WebLiveEvent & { type: "setup-status" }>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    for (const event of this.setupStatuses.values()) listener(event);
    return () => this.listeners.delete(listener);
  }

  publish(event: WebLiveEvent): void {
    if (event.type === "setup-status") this.rememberSetupStatus(event);
    for (const listener of this.listeners) listener(event);
  }

  publishBotEvent(event: BotEvent): void {
    const converted = liveEventFromBotEvent(event);
    if (converted) this.publish(converted);
  }

  private rememberSetupStatus(event: WebLiveEvent & { type: "setup-status" }): void {
    if (event.active || event.tone === "danger") {
      this.setupStatuses.set(event.key, event);
    } else {
      this.setupStatuses.delete(event.key);
    }
  }
}

export function messageEvent(
  conversationId: string,
  message: BotMessage,
): WebLiveEvent {
  return {
    type: "message",
    id: crypto.randomUUID(),
    conversationId,
    createdAt: new Date().toISOString(),
    message: serializableMessage(message),
  };
}

export function userMessageEvent(
  conversationId: string,
  text: string,
  createdAt: Date = new Date(),
): WebLiveEvent {
  return messageEvent(conversationId, {
    role: "user",
    content: text,
    createdAt: createdAt.toISOString(),
  });
}

export function serializableMessage(message: BotMessage): SerializableBotMessage {
  if (message.role === "user") return message;
  if (message.kind === "text") return message;
  const { toolResult, toolArgs, ...rest } = message;
  return {
    ...rest,
    toolArgs: toJsonValue(toolArgs),
    ...(toolResult === undefined
      ? {}
      : { toolResult: toJsonValue(toolResult) }),
  };
}

export function serializableSession(
  session: BotSessionSummary,
): SerializableSessionSummary {
  return {
    ...session,
    expiresAt: session.expiresAt.toISOString(),
  };
}

function liveEventFromBotEvent(event: BotEvent): WebLiveEvent | undefined {
  if (event.type === "setup.status") {
    return setupStatus(event.status);
  }
  if (!("conversationId" in event) || !event.conversationId) return undefined;
  if (event.type === "agent.started") {
    return activity(event.conversationId, `agent started: ${event.provider} / ${event.model}`);
  }
  if (event.type === "agent.turn") {
    return activity(event.conversationId, event.summary, event.detail);
  }
  if (event.type === "agent.clarification") {
    return activity(event.conversationId, "agent requested clarification");
  }
  if (event.type === "agent.completed") {
    return activity(event.conversationId, "agent completed", undefined, "success");
  }
  if (event.type === "sandbox.starting") {
    return setupStatus({ key: "sandbox", label: "starting sandbox", active: true });
  }
  if (event.type === "sandbox.resuming") {
    return setupStatus({ key: "sandbox", label: "resuming sandbox", active: true });
  }
  if (event.type === "sandbox.created") {
    return setupStatus({ key: "sandbox", label: "sandbox ready", active: false, tone: "success", progress: 1 });
  }
  if (event.type === "sandbox.exec") {
    return activity(event.conversationId, `$ ${event.command}`, { command: event.command });
  }
  if (event.type === "sandbox.destroyed") {
    return activity(event.conversationId, `sandbox stopped: ${event.sessionId}`);
  }
  if (event.type === "sandbox.mountsRefreshPending") {
    return activity(event.conversationId, "mounts updating after current run", undefined, "neutral");
  }
  if (event.type === "sandbox.mountsRefreshing") {
    return setupStatus({ key: "sandbox", label: "refreshing sandbox mounts", active: true });
  }
  if (event.type === "sandbox.mountsRefreshed") {
    return setupStatus({ key: "sandbox", label: "sandbox mounts refreshed", active: false, tone: "success", progress: 1 });
  }
  if (event.type === "error") {
    return activity(event.conversationId, event.message, event.cause, "danger");
  }
  return undefined;
}

function setupStatus(status: SetupStatusInput): WebLiveEvent {
  return {
    type: "setup-status",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    tone: "neutral",
    ...status,
  };
}

function toJsonValue(value: unknown): JsonValue {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

function activity(
  conversationId: string,
  label: string,
  detail?: unknown,
  tone: "neutral" | "danger" | "success" = "neutral",
): WebLiveEvent {
  return {
    type: "activity",
    id: crypto.randomUUID(),
    conversationId,
    createdAt: new Date().toISOString(),
    label,
    detail,
    tone,
  };
}
