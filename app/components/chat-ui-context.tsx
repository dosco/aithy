import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { saveSettingsWithSetupGateRefresh } from "@/lib/setup-gate";
import type { UiPreferences } from "../../src/settings/types";

interface ChatUiState {
  details: boolean;
  setDetails: (value: boolean) => void;
}

const ChatUiContext = createContext<ChatUiState | null>(null);

function readInitialDetails(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = JSON.parse(window.localStorage.getItem("aithy-theme") || "{}");
    return Boolean(stored.detailsDefault);
  } catch {
    return false;
  }
}

export function ChatUiProvider({ children }: { children: ReactNode }) {
  const [details, setDetailsState] = useState(false);
  useEffect(() => {
    setDetailsState(readInitialDetails());
  }, []);
  const setDetails = useCallback((value: boolean) => {
    setDetailsState(value);
    cacheDetailsDefault(value);
    void saveSettingsWithSetupGateRefresh({ data: { ui: { detailsDefault: value } } }).catch(() => {});
  }, []);
  return <ChatUiContext.Provider value={{ details, setDetails }}>{children}</ChatUiContext.Provider>;
}

export function useChatUi(): ChatUiState {
  const value = useContext(ChatUiContext);
  if (!value) return { details: false, setDetails: () => {} };
  return value;
}

function cacheDetailsDefault(value: boolean): void {
  if (typeof window === "undefined") return;
  let stored: Partial<UiPreferences> = {};
  try {
    stored = JSON.parse(window.localStorage.getItem("aithy-theme") || "{}") as Partial<UiPreferences>;
  } catch {}
  window.localStorage.setItem("aithy-theme", JSON.stringify({ ...stored, detailsDefault: value }));
}
