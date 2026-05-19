import type {
  BotMessage,
  BotSessionSummary,
  SessionNameSource,
} from "./types";

export interface MessagePageInput {
  beforeId?: number | null;
  limit: number;
}

export interface MessagePage {
  items: Array<{ id: number; message: BotMessage }>;
  oldestId: number | null;
  newestId: number | null;
  hasMoreBefore: boolean;
}

export interface MessageRangeInput {
  startId: number;
  endId: number;
  limit: number;
}

export type MessageRange = Array<{ id: number; message: BotMessage }>;

export interface LogicalSessionInput {
  conversationId: string;
  name: string;
  nameSource: SessionNameSource;
  source: string;
  model?: string | null;
  systemPrompt?: string | null;
  parentSessionId?: string | null;
  parentMessageId?: number | null;
  now: string;
  expiresAt: Date;
}

export interface SessionStateStore {
  ensureSession(input: LogicalSessionInput): void;
  loadSession(conversationId: string): StoredSession | undefined;
  listSessions(): BotSessionSummary[];
  findSessionsByName(name: string): BotSessionSummary[];
  getSummary(conversationId: string): BotSessionSummary | undefined;
  renameSession(conversationId: string, name: string): void;
  clearSession(conversationId: string, now: string): void;
  deleteSession(conversationId: string): void;
  deleteAllSessions(): void;
  appendMessages(conversationId: string, messages: BotMessage[]): void;
  messagesPage(conversationId: string, input: MessagePageInput): MessagePage;
  messagesByIdRange?(conversationId: string, input: MessageRangeInput): MessageRange | Promise<MessageRange>;
  childSessions(parentId: string): BotSessionSummary[];
  lastMessageId(conversationId: string): number | null;
  close?(): void;
}

export interface StoredSession extends BotSessionSummary {
  messages: BotMessage[];
}
