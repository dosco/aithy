export interface PendingChatSkill {
  id: string;
  name: string;
}

export interface PendingChatMessage {
  id: string;
  conversationId: string;
  text: string;
  queuedAt: string;
  skills: PendingChatSkill[];
}

export type PendingChatQueueStore = Record<string, PendingChatMessage[]>;

export const PENDING_CHAT_QUEUE_STORAGE_KEY = "aithy.pendingChatQueue.v1";

export interface PendingChatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function pendingMessagesForSession(
  store: PendingChatQueueStore,
  conversationId: string | null,
): PendingChatMessage[] {
  if (!conversationId) return [];
  return store[conversationId] ?? [];
}

export function addPendingMessage(
  store: PendingChatQueueStore,
  message: PendingChatMessage,
): PendingChatQueueStore {
  return withSessionMessages(store, message.conversationId, [
    ...pendingMessagesForSession(store, message.conversationId),
    message,
  ]);
}

export function removePendingMessage(
  store: PendingChatQueueStore,
  conversationId: string,
  messageId: string,
): PendingChatQueueStore {
  return withSessionMessages(
    store,
    conversationId,
    pendingMessagesForSession(store, conversationId).filter((message) => message.id !== messageId),
  );
}

export function prependPendingMessage(
  store: PendingChatQueueStore,
  message: PendingChatMessage,
): PendingChatQueueStore {
  return withSessionMessages(store, message.conversationId, [
    message,
    ...pendingMessagesForSession(store, message.conversationId),
  ]);
}

export function dequeuePendingMessage(
  store: PendingChatQueueStore,
  conversationId: string,
): { store: PendingChatQueueStore; message: PendingChatMessage | null } {
  const messages = pendingMessagesForSession(store, conversationId);
  const [message, ...rest] = messages;
  if (!message) return { store, message: null };
  return { store: withSessionMessages(store, conversationId, rest), message };
}

export function loadPendingChatQueue(
  storage: PendingChatStorage | undefined,
): PendingChatQueueStore {
  if (!storage) return {};
  try {
    return sanitizeStore(JSON.parse(storage.getItem(PENDING_CHAT_QUEUE_STORAGE_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

export function savePendingChatQueue(
  storage: PendingChatStorage | undefined,
  store: PendingChatQueueStore,
): void {
  if (!storage) return;
  const sanitized = sanitizeStore(store);
  try {
    if (Object.keys(sanitized).length === 0) {
      storage.removeItem(PENDING_CHAT_QUEUE_STORAGE_KEY);
    } else {
      storage.setItem(PENDING_CHAT_QUEUE_STORAGE_KEY, JSON.stringify(sanitized));
    }
  } catch {
    // Browser storage may be unavailable or full; in-memory state still works.
  }
}

function withSessionMessages(
  store: PendingChatQueueStore,
  conversationId: string,
  messages: PendingChatMessage[],
): PendingChatQueueStore {
  const next = { ...store };
  if (messages.length === 0) {
    delete next[conversationId];
  } else {
    next[conversationId] = messages;
  }
  return next;
}

function sanitizeStore(value: unknown): PendingChatQueueStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: PendingChatQueueStore = {};
  for (const [conversationId, messages] of Object.entries(value)) {
    if (typeof conversationId !== "string" || !Array.isArray(messages)) continue;
    const clean = messages.flatMap((message) => {
      const parsed = sanitizeMessage(message, conversationId);
      return parsed ? [parsed] : [];
    });
    if (clean.length > 0) out[conversationId] = clean;
  }
  return out;
}

function sanitizeMessage(value: unknown, conversationId: string): PendingChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<PendingChatMessage>;
  if (
    typeof message.id !== "string"
    || typeof message.text !== "string"
    || message.text.trim().length === 0
    || typeof message.queuedAt !== "string"
  ) {
    return null;
  }
  const skills = Array.isArray(message.skills)
    ? message.skills.flatMap((skill) => {
        if (!skill || typeof skill !== "object") return [];
        const entry = skill as Partial<PendingChatSkill>;
        return typeof entry.id === "string" && typeof entry.name === "string"
          ? [{ id: entry.id, name: entry.name }]
          : [];
      })
    : [];
  return {
    id: message.id,
    conversationId,
    text: message.text,
    queuedAt: message.queuedAt,
    skills,
  };
}
