import type { AppConfig, GlobalMount, SandboxProviderKind } from "../config/env";
import type { LocalInferenceSettings } from "../local-inference/settings";
import type { CustomSandboxImage, SandboxImageSelection } from "../sandbox/image-catalog";

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

export type ValidationStatus = "unknown" | "valid" | "invalid" | "not-required";

export interface ProviderValidationState {
  status: ValidationStatus;
  fingerprint?: string;
  validatedAt?: string;
  message?: string | null;
}

export interface AiProviderProfile {
  apiUrl?: string | null;
  model?: string | null;
  fastApiUrl?: string | null;
  fastModel?: string | null;
  secretVersion?: number;
  validation?: ProviderValidationState;
  fastValidation?: ProviderValidationState;
}

export type BuiltInSearchProviderId = "parallel" | "grok-subscription";
export type MeshSearchProviderId = `mesh:${string}:search:${string}`;
export type SearchProviderId = BuiltInSearchProviderId | MeshSearchProviderId;
export type SearchProviderMode = "anonymous" | "api-key" | "grok-subscription";

export interface SearchProviderProfile {
  url?: string | null;
  mode?: SearchProviderMode;
  secretVersion?: number;
  validation?: ProviderValidationState;
}

export interface RuntimeSettings {
  aiProvider?: string;
  aiApiUrl?: string | null;
  aiApiKey?: string | null;
  aiModel?: string | null;
  localAgentModel?: string | null;
  localInference?: Partial<LocalInferenceSettings>;
  fastAiProvider?: string;
  fastAiApiUrl?: string | null;
  fastAiModel?: string;
  aiProviderProfiles?: Record<string, AiProviderProfile>;
  searchProvider?: SearchProviderId;
  searchProviderProfiles?: Record<string, SearchProviderProfile>;
  sandboxProvider?: SandboxProviderKind;
  sandboxImageSelection?: SandboxImageSelection;
  customSandboxImages?: CustomSandboxImage[];
  /** Legacy raw image setting. Read for migration only; new saves use sandboxImageSelection. */
  sandboxImage?: string;
  sandboxCpus?: number;
  sandboxMemoryMb?: number;
  sandboxNetwork?: AppConfig["sandboxNetwork"];
  sessionTtlMs?: number;
  parallelAgents?: number;
  parallelSearchMcpUrl?: string | null;
  parallelApiKey?: string | null;
  systemBashEnabled?: boolean;
  trainingDataCaptureEnabled?: boolean;
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
