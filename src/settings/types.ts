import type { AppConfig, GlobalMount, SandboxProviderKind } from "../config/env";

export type { GlobalMount };

export type ThemeName =
  | "paper"
  | "graphite"
  | "violet-ascii"
  | "terminal-glow"
  | "sunrise"
  | "ocean"
  | "matcha"
  | "rose-quartz"
  | "noir"
  | "amber";
export type ColorMode = "light" | "dark" | "system";
export type LayoutName = "chat" | "work";

export interface UiPreferences {
  theme: ThemeName;
  colorMode: ColorMode;
  layout: LayoutName;
  detailsDefault: boolean;
  lastActiveSessionId: string | null;
}

export interface RuntimeSettings {
  aiProvider?: string;
  aiModel?: string;
  fastAiProvider?: string;
  fastAiModel?: string;
  sandboxProvider?: SandboxProviderKind;
  sandboxImage?: string;
  sandboxCpus?: number;
  sandboxMemoryMb?: number;
  sandboxNetwork?: AppConfig["sandboxNetwork"];
  sessionTtlMs?: number;
  traceEnabled?: boolean;
  globalMounts?: GlobalMount[];
}

export interface StoredSettings {
  runtime: RuntimeSettings;
  ui: UiPreferences;
  updatedAt: string;
}

export interface SettingsPatch {
  runtime?: RuntimeSettings;
  ui?: Partial<UiPreferences>;
}

export const defaultUiPreferences: UiPreferences = {
  theme: "paper",
  colorMode: "system",
  layout: "chat",
  detailsDefault: false,
  lastActiveSessionId: null,
};

export const metadataSettingsKey = "web.settings";
export const aithySecretService = "com.aithy.local";
