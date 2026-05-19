import type { BotMessage, BotSessionSummary } from "../../session/types";
import type {
  LogicalSessionInput,
  MessagePage,
  MessagePageInput,
  MessageRangeInput,
  StoredSession,
} from "../../session/state-store";
import type { WebLiveEvent } from "../../web/live-events";
import type {
  CommandCompletion,
  RuntimeLogEventPayload,
  RuntimeQueueStatus,
  RuntimeServiceRole,
  RuntimeServiceState,
  RuntimeServiceStatus,
} from "./types";
import type { RuntimeCommandRow } from "../runtime-store-types";

export type RuntimeBusMethod =
  | "runtime.command.submit"
  | "runtime.command.invoke"
  | "runtime.command.complete"
  | "runtime.log"
  | "runtime.event"
  | "runtime.queueStatus"
  | "runtime.serviceStatus"
  | "runtime.service"
  | "runtime.services"
  | "runtime.consoleSnapshot"
  | "session.ensure"
  | "session.load"
  | "session.list"
  | "session.findByName"
  | "session.summary"
  | "session.rename"
  | "session.clear"
  | "session.delete"
  | "session.deleteAll"
  | "session.appendMessages"
  | "session.messagesPage"
  | "session.messagesByIdRange"
  | "session.childSessions"
  | "session.lastMessageId";

export type RuntimeBusRequest =
  | { id: string; type: "request"; method: "runtime.command.submit"; params: CommandSubmitParams }
  | { id: string; type: "request"; method: "runtime.command.invoke"; params: CommandInvokeParams }
  | { id: string; type: "request"; method: "runtime.command.complete"; params: CommandCompleteParams }
  | { id: string; type: "request"; method: "runtime.log"; params: RuntimeLogEventPayload }
  | { id: string; type: "request"; method: "runtime.event"; params: { event: WebLiveEvent } }
  | { id: string; type: "request"; method: "runtime.queueStatus"; params: { queue: RuntimeQueueStatus } }
  | { id: string; type: "request"; method: "runtime.serviceStatus"; params: ServiceStatusParams }
  | { id: string; type: "request"; method: "runtime.service"; params: { role: RuntimeServiceRole } }
  | { id: string; type: "request"; method: "runtime.services"; params: Record<string, never> }
  | { id: string; type: "request"; method: "runtime.consoleSnapshot"; params: { logLimit?: number; commandLimit?: number } }
  | { id: string; type: "request"; method: "session.ensure"; params: LogicalSessionInput }
  | { id: string; type: "request"; method: "session.load"; params: { conversationId: string } }
  | { id: string; type: "request"; method: "session.list"; params: Record<string, never> }
  | { id: string; type: "request"; method: "session.findByName"; params: { name: string } }
  | { id: string; type: "request"; method: "session.summary"; params: { conversationId: string } }
  | { id: string; type: "request"; method: "session.rename"; params: { conversationId: string; name: string } }
  | { id: string; type: "request"; method: "session.clear"; params: { conversationId: string; now: string } }
  | { id: string; type: "request"; method: "session.delete"; params: { conversationId: string } }
  | { id: string; type: "request"; method: "session.deleteAll"; params: Record<string, never> }
  | { id: string; type: "request"; method: "session.appendMessages"; params: { conversationId: string; messages: BotMessage[] } }
  | { id: string; type: "request"; method: "session.messagesPage"; params: { conversationId: string; input: MessagePageInput } }
  | { id: string; type: "request"; method: "session.messagesByIdRange"; params: { conversationId: string; input: MessageRangeInput } }
  | { id: string; type: "request"; method: "session.childSessions"; params: { parentId: string } }
  | { id: string; type: "request"; method: "session.lastMessageId"; params: { conversationId: string } };

export type RuntimeBusResponse =
  | { id: string; type: "response"; ok: true; result: unknown }
  | { id: string; type: "response"; ok: false; error: string };

export type RuntimeBusServerFrame =
  | RuntimeBusResponse
  | { type: "event"; event: WebLiveEvent }
  | { type: "command.dispatch"; command: RuntimeCommandRow };

export type RuntimeBusClientFrame =
  | RuntimeBusRequest
  | { type: "hello"; role: RuntimeServiceRole; pid: number; instanceId: string };

export interface CommandSubmitParams {
  targetRole: RuntimeServiceRole;
  kind: string;
  payload?: unknown;
}

export interface CommandInvokeParams extends CommandSubmitParams {
  timeoutMs?: number;
}

export interface CommandCompleteParams {
  commandId: string;
  completion: CommandCompletion;
}

export interface ServiceStatusParams {
  role: RuntimeServiceRole;
  state: RuntimeServiceState;
  detail?: unknown;
  pid?: number | null;
}

export interface RuntimeConsoleSnapshot {
  services: RuntimeServiceStatus[];
  setupStatuses: Array<WebLiveEvent & { type: "setup-status" }>;
  logs: Array<{ id: number | string; event: WebLiveEvent; createdAt: string }>;
  commands: RuntimeCommandRow[];
  queues: RuntimeQueueStatus[];
}

export interface SessionView {
  session: BotSessionSummary | null;
  messagePage: MessagePage;
}

export interface RuntimeBusStateApi {
  ensure(input: LogicalSessionInput): Promise<BotSessionSummary>;
  load(conversationId: string): Promise<StoredSession | undefined>;
  list(): Promise<BotSessionSummary[]>;
  findByName(name: string): Promise<BotSessionSummary[]>;
  summary(conversationId: string): Promise<BotSessionSummary | undefined>;
  rename(conversationId: string, name: string): Promise<BotSessionSummary | undefined>;
  clear(conversationId: string, now: string): Promise<BotSessionSummary>;
  delete(conversationId: string): Promise<void>;
  deleteAll(): Promise<void>;
  appendMessages(conversationId: string, messages: BotMessage[]): Promise<MessagePage>;
  messagesPage(conversationId: string, input: MessagePageInput): Promise<MessagePage>;
  childSessions(parentId: string): Promise<BotSessionSummary[]>;
  lastMessageId(conversationId: string): Promise<number | null>;
}
