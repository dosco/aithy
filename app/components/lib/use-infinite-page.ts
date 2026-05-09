import { useCallback, useEffect, useRef, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

export interface PageResult<T, C> {
  items: T[];
  nextCursor: C | null;
}

export interface UseInfinitePageArgs<T, C> {
  initial: PageResult<T, C>;
  fetchPage: (cursor: C | null) => Promise<PageResult<T, C>>;
  resetKey: string;
  rootMargin?: string;
}

export interface UseInfinitePageResult<T> {
  items: T[];
  done: boolean;
  loading: boolean;
  sentinelRef: (node: HTMLElement | null) => void;
  prependItem: (item: T) => void;
  replaceItem: (id: string, item: T) => void;
  removeItem: (id: string) => void;
}

interface Identifiable {
  id: string;
}

export function useInfinitePage<T extends Identifiable, C>({
  initial,
  fetchPage,
  resetKey,
  rootMargin = "200px",
}: UseInfinitePageArgs<T, C>): UseInfinitePageResult<T> {
  const [items, setItems] = useState<T[]>(initial.items);
  const [cursor, setCursor] = useState<C | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const lastKeyRef = useRef(resetKey);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (resetKey === lastKeyRef.current) return;
    lastKeyRef.current = resetKey;
    let cancelled = false;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    fetchPage(null)
      .then((page) => {
        if (cancelled || reqId !== reqIdRef.current) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .finally(() => {
        if (cancelled || reqId !== reqIdRef.current) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resetKey, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || cursor === null) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    fetchPage(cursor)
      .then((page) => {
        if (reqId !== reqIdRef.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const merged = prev.slice();
          for (const item of page.items) {
            if (!seen.has(item.id)) merged.push(item);
          }
          return merged;
        });
        setCursor(page.nextCursor);
      })
      .finally(() => {
        if (reqId !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [cursor, fetchPage, loading]);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!node) return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              loadMore();
              break;
            }
          }
        },
        { rootMargin },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [loadMore, rootMargin],
  );

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  const prependItem = useCallback((item: T) => {
    setItems((prev) => {
      const without = prev.filter((p) => p.id !== item.id);
      return [item, ...without];
    });
  }, []);

  const replaceItem = useCallback((id: string, item: T) => {
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return [item, ...prev];
      const next = prev.slice();
      next[idx] = item;
      return next;
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return {
    items,
    done: cursor === null,
    loading,
    sentinelRef,
    prependItem,
    replaceItem,
    removeItem,
  };
}
