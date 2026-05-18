import { useCallback, useEffect, useMemo, useState } from "react";
import type { SelectedSkill } from "@/components/chat-composer";
import {
  addPendingMessage,
  dequeuePendingMessage,
  loadPendingChatQueue,
  pendingMessagesForSession,
  prependPendingMessage,
  removePendingMessage,
  savePendingChatQueue,
  type PendingChatMessage,
  type PendingChatQueueStore,
} from "@/components/pending-chat-queue-state";

interface PendingMessageInput {
  conversationId: string;
  text: string;
  skills: SelectedSkill[];
}

export function usePendingChatQueue(activeSessionId: string | null) {
  const [store, setStore] = useState<PendingChatQueueStore>(() => loadPendingChatQueue(browserStorage()));

  useEffect(() => {
    setStore(loadPendingChatQueue(browserStorage()));
  }, []);

  const pendingMessages = useMemo(
    () => pendingMessagesForSession(store, activeSessionId),
    [store, activeSessionId],
  );

  const updateStore = useCallback((next: PendingChatQueueStore) => {
    setStore(next);
    savePendingChatQueue(browserStorage(), next);
  }, []);

  const enqueuePending = useCallback((input: PendingMessageInput) => {
    const message: PendingChatMessage = {
      id: crypto.randomUUID(),
      conversationId: input.conversationId,
      text: input.text,
      queuedAt: new Date().toISOString(),
      skills: input.skills.map((skill) => ({ id: skill.id, name: skill.name })),
    };
    setStore((current) => {
      const next = addPendingMessage(current, message);
      savePendingChatQueue(browserStorage(), next);
      return next;
    });
    return message;
  }, []);

  const removePending = useCallback((conversationId: string, messageId: string) => {
    updateStore(removePendingMessage(store, conversationId, messageId));
  }, [store, updateStore]);

  const dequeuePending = useCallback((conversationId: string) => {
    const result = dequeuePendingMessage(store, conversationId);
    updateStore(result.store);
    return result.message;
  }, [store, updateStore]);

  const restorePending = useCallback((message: PendingChatMessage) => {
    setStore((current) => {
      const next = prependPendingMessage(current, message);
      savePendingChatQueue(browserStorage(), next);
      return next;
    });
  }, []);

  return {
    pendingMessages,
    enqueuePending,
    removePending,
    dequeuePending,
    restorePending,
    setPendingStore: updateStore,
  };
}

function browserStorage() {
  if (typeof window === "undefined") return undefined;
  return window.localStorage;
}
