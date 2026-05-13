import { useCallback, useEffect, useState } from "react";
import { prependUnique } from "@/components/chat-message-state";
import type { ChatMessageItem } from "@/components/chat-timeline";
import { getSessionMessages } from "@/server/session-messages.functions";
import type { MessagePageDto } from "@/server/dto";

export function useChatMessages(
  activeSessionId: string | null,
  initialPage: MessagePageDto,
) {
  const [messages, setMessages] = useState<ChatMessageItem[]>(initialPage.items);
  const [oldestMessageId, setOldestMessageId] = useState<number | null>(initialPage.oldestId);
  const [hasMoreBefore, setHasMoreBefore] = useState(initialPage.hasMoreBefore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [emptyReloadKey, setEmptyReloadKey] = useState<string | null>(null);

  useEffect(() => {
    setMessages(initialPage.items);
    setOldestMessageId(initialPage.oldestId);
    setHasMoreBefore(initialPage.hasMoreBefore);
    setLoadingMore(false);
    setEmptyReloadKey(null);
  }, [activeSessionId, initialPage]);

  useEffect(() => {
    if (!activeSessionId || messages.length > 0 || loadingMore || emptyReloadKey === activeSessionId) return;
    setEmptyReloadKey(activeSessionId);
    setLoadingMore(true);
    void getSessionMessages({
      data: { conversationId: activeSessionId, beforeId: null, limit: 10 },
    }).then((page) => {
      if (page.items.length === 0) return;
      setMessages(page.items);
      setOldestMessageId(page.oldestId);
      setHasMoreBefore(page.hasMoreBefore);
    }).finally(() => setLoadingMore(false));
  }, [activeSessionId, messages.length, loadingMore, emptyReloadKey]);

  const loadMoreMessages = useCallback(async (): Promise<boolean> => {
    if (!activeSessionId || !oldestMessageId || loadingMore || !hasMoreBefore) return false;
    setLoadingMore(true);
    try {
      const page = await getSessionMessages({
        data: { conversationId: activeSessionId, beforeId: oldestMessageId, limit: 10 },
      });
      if (page.items.length === 0) {
        setHasMoreBefore(false);
        return false;
      }
      setMessages((current) => prependUnique(current, page.items));
      setOldestMessageId(page.oldestId);
      setHasMoreBefore(page.hasMoreBefore);
      return true;
    } finally {
      setLoadingMore(false);
    }
  }, [activeSessionId, oldestMessageId, loadingMore, hasMoreBefore]);

  function clearMessages(): void {
    setMessages([]);
    setOldestMessageId(null);
    setHasMoreBefore(false);
    setEmptyReloadKey(null);
  }

  return {
    messages,
    setMessages,
    hasMoreBefore,
    loadingMore,
    loadMoreMessages,
    clearMessages,
  };
}
