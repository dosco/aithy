import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";
import type { WebLiveEvent } from "../../src/web/live-events";

export type LiveEventMessage = WebLiveEvent | { type: "connected"; createdAt: string };
export type LiveConnectionState = "connecting" | "connected" | "error";

type LiveEventListener = (event: LiveEventMessage) => void;

interface LiveEventSourceLike {
  onmessage: ((message: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

interface LiveEventsContextValue {
  subscribe(listener: LiveEventListener): () => void;
  connectionState: LiveConnectionState;
}

const LiveEventsContext = createContext<LiveEventsContextValue | null>(null);

export function LiveEventsProvider({
  children,
  createSource = defaultCreateSource,
}: {
  children: ReactNode;
  createSource?: (url: string) => LiveEventSourceLike;
}) {
  const bus = useMemo(() => createLiveEventBus(), []);
  const [connectionState, setConnectionState] = useState<LiveConnectionState>("connecting");

  useEffect(() => {
    setConnectionState("connecting");
    const source = createSource("/api/events");
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEventMessage;
      if (event.type === "connected") setConnectionState("connected");
      bus.publish(event);
    };
    source.onerror = () => setConnectionState("error");
    return () => source.close();
  }, [bus, createSource]);

  const value = useMemo<LiveEventsContextValue>(
    () => ({
      subscribe: bus.subscribe,
      connectionState,
    }),
    [bus.subscribe, connectionState],
  );

  return (
    <LiveEventsContext.Provider value={value}>
      {children}
    </LiveEventsContext.Provider>
  );
}

export function useLiveEvent(
  handler: LiveEventListener,
  deps: DependencyList = [],
): void {
  const context = useRequiredLiveEventsContext();
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler, ...deps]);
  useEffect(
    () => context.subscribe((event) => handlerRef.current(event)),
    [context],
  );
}

export function useLiveConnectionState(): LiveConnectionState {
  return useRequiredLiveEventsContext().connectionState;
}

export function createLiveEventBus() {
  const listeners = new Set<LiveEventListener>();
  return {
    subscribe(listener: LiveEventListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event: LiveEventMessage): void {
      for (const listener of listeners) listener(event);
    },
    listenerCount(): number {
      return listeners.size;
    },
  };
}

function useRequiredLiveEventsContext(): LiveEventsContextValue {
  const context = useContext(LiveEventsContext);
  if (!context) throw new Error("LiveEventsProvider is missing");
  return context;
}

function defaultCreateSource(url: string): LiveEventSourceLike {
  return new EventSource(url);
}
