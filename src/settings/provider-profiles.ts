import { createHash } from "node:crypto";
import {
  isLocalAiProvider,
  isXaiGrokSubscriptionProvider,
  normalizeProfileArgs,
  type AiServiceTier,
  type AiThinkingLevel,
} from "../agent/ai-providers";
import { isMeshInferenceProvider, isMeshSearchProvider } from "../mesh/types";
import type {
  AiProviderProfile,
  BuiltInSearchProviderId,
  ProviderValidationState,
  RuntimeSettings,
  SearchProviderId,
  SearchProviderMode,
  SearchProviderProfile,
} from "./types";

export const PARALLEL_SEARCH_PROVIDER: SearchProviderId = "parallel";
export const GROK_SEARCH_PROVIDER: SearchProviderId = "grok-subscription";
export const SEARCH_PROVIDERS: readonly BuiltInSearchProviderId[] = [PARALLEL_SEARCH_PROVIDER, GROK_SEARCH_PROVIDER];

export function aiProfileFor(settings: RuntimeSettings, provider: string): AiProviderProfile {
  return settings.aiProviderProfiles?.[provider] ?? {};
}

export function searchProfileFor(settings: RuntimeSettings, provider: SearchProviderId): SearchProviderProfile {
  return settings.searchProviderProfiles?.[provider] ?? {};
}

export function activeSearchProvider(settings: RuntimeSettings): SearchProviderId {
  return isSearchProvider(settings.searchProvider) ? settings.searchProvider : PARALLEL_SEARCH_PROVIDER;
}

export function isSearchProvider(value: unknown): value is SearchProviderId {
  return value === PARALLEL_SEARCH_PROVIDER || value === GROK_SEARCH_PROVIDER
    || (typeof value === "string" && isMeshSearchProvider(value));
}

export function providerNeedsLiveValidation(provider: string): boolean {
  return !isLocalAiProvider(provider) && !isMeshInferenceProvider(provider) && !isXaiGrokSubscriptionProvider(provider);
}

export function validationNotRequired(message = "Validation is not required for this provider."): ProviderValidationState {
  return {
    status: "not-required",
    fingerprint: "not-required",
    validatedAt: new Date().toISOString(),
    message,
  };
}

export function validValidation(fingerprint: string): ProviderValidationState {
  return {
    status: "valid",
    fingerprint,
    validatedAt: new Date().toISOString(),
    message: null,
  };
}

export function staleValidation(
  validation: ProviderValidationState | undefined,
  fingerprint: string,
): ProviderValidationState | undefined {
  if (!validation) return undefined;
  if (validation.status === "not-required") return validation;
  return validation.fingerprint === fingerprint ? validation : { status: "unknown", fingerprint };
}

export function aiProfileFingerprint(input: {
  provider: string;
  apiUrl?: string;
  model?: string;
  profileArgs?: Readonly<Record<string, string>>;
  thinkingLevel?: AiThinkingLevel;
  serviceTier?: AiServiceTier;
  secretVersion?: number;
  purpose?: "primary" | "fast";
}): string {
  return stableFingerprint({
    kind: "llm",
    provider: input.provider,
    apiUrl: input.apiUrl ?? "",
    model: input.model ?? "",
    profileArgs: sortedRecord(input.profileArgs),
    thinkingLevel: input.thinkingLevel ?? "",
    serviceTier: input.serviceTier ?? "",
    secretVersion: input.secretVersion ?? 0,
    purpose: input.purpose ?? "primary",
  });
}

export function searchProfileFingerprint(input: {
  provider: SearchProviderId;
  url?: string;
  mode?: SearchProviderMode;
  secretVersion?: number;
}): string {
  return stableFingerprint({
    kind: "search",
    provider: input.provider,
    url: input.url ?? "",
    mode: input.mode ?? "anonymous",
    secretVersion: input.secretVersion ?? 0,
  });
}

export function upsertAiProfile(
  settings: RuntimeSettings,
  provider: string,
  patch: AiProviderProfile,
): Record<string, AiProviderProfile> {
  return {
    ...(settings.aiProviderProfiles ?? {}),
    [provider]: compactProfile({ ...aiProfileFor(settings, provider), ...patch }, provider),
  };
}

export function upsertSearchProfile(
  settings: RuntimeSettings,
  provider: SearchProviderId,
  patch: SearchProviderProfile,
): Record<string, SearchProviderProfile> {
  return {
    ...(settings.searchProviderProfiles ?? {}),
    [provider]: compactSearchProfile({ ...searchProfileFor(settings, provider), ...patch }),
  };
}

export function normalizeAiProfiles(runtime: RuntimeSettings): Record<string, AiProviderProfile> | undefined {
  const profiles: Record<string, AiProviderProfile> = {};
  for (const [provider, profile] of Object.entries(runtime.aiProviderProfiles ?? {})) {
    if (!provider.trim() || !profile || typeof profile !== "object") continue;
    profiles[provider] = compactProfile(profile, provider);
  }
  if (runtime.aiProvider) {
    profiles[runtime.aiProvider] = compactProfile({
      ...(profiles[runtime.aiProvider] ?? {}),
      ...(runtime.aiApiUrl !== undefined ? { apiUrl: runtime.aiApiUrl } : {}),
      ...(runtime.aiModel !== undefined ? { model: runtime.aiModel } : {}),
      ...(runtime.aiProfileArgs !== undefined ? { profileArgs: runtime.aiProfileArgs } : {}),
      ...(runtime.aiThinkingLevel !== undefined ? { thinkingLevel: runtime.aiThinkingLevel } : {}),
      ...(runtime.aiServiceTier !== undefined ? { serviceTier: runtime.aiServiceTier } : {}),
    }, runtime.aiProvider);
  }
  if (runtime.fastAiProvider) {
    profiles[runtime.fastAiProvider] = compactProfile({
      ...(profiles[runtime.fastAiProvider] ?? {}),
      ...(runtime.fastAiApiUrl !== undefined ? { fastApiUrl: runtime.fastAiApiUrl } : {}),
      ...(runtime.fastAiModel !== undefined ? { fastModel: runtime.fastAiModel } : {}),
      ...(runtime.fastAiProfileArgs !== undefined ? { fastProfileArgs: runtime.fastAiProfileArgs } : {}),
      ...(runtime.fastAiThinkingLevel !== undefined ? { fastThinkingLevel: runtime.fastAiThinkingLevel } : {}),
      ...(runtime.fastAiServiceTier !== undefined ? { fastServiceTier: runtime.fastAiServiceTier } : {}),
    }, runtime.fastAiProvider);
  }
  const normalized = Object.fromEntries(
    Object.entries(profiles).map(([provider, profile]) => [provider, normalizeAiProfileValidation(provider, profile)]),
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeSearchProfiles(runtime: RuntimeSettings): Record<string, SearchProviderProfile> | undefined {
  const profiles: Record<string, SearchProviderProfile> = {};
  for (const [provider, profile] of Object.entries(runtime.searchProviderProfiles ?? {})) {
    if (!isSearchProvider(provider) || !profile || typeof profile !== "object") continue;
    profiles[provider] = compactSearchProfile(profile);
  }
  if (runtime.parallelSearchMcpUrl !== undefined || runtime.parallelApiKey !== undefined) {
    profiles.parallel = compactSearchProfile({
      ...(profiles.parallel ?? {}),
      ...(runtime.parallelSearchMcpUrl !== undefined ? { url: runtime.parallelSearchMcpUrl } : {}),
      mode: runtime.parallelApiKey === null ? "anonymous" : profiles.parallel?.mode ?? "api-key",
    });
  }
  const normalized = Object.fromEntries(
    Object.entries(profiles).map(([provider, profile]) => [
      provider,
      normalizeSearchProfileValidation(provider as SearchProviderId, profile),
    ]),
  );
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAiProfileValidation(provider: string, profile: AiProviderProfile): AiProviderProfile {
  return compactProfile({
    ...profile,
    validation: profile.validation
      ? staleValidation(profile.validation, aiProfileFingerprint({
        provider,
        apiUrl: profile.apiUrl ?? undefined,
        model: profile.model ?? undefined,
        profileArgs: profile.profileArgs,
        thinkingLevel: profile.thinkingLevel ?? undefined,
        serviceTier: profile.serviceTier,
        secretVersion: profile.secretVersion,
        purpose: "primary",
      }))
      : undefined,
    fastValidation: profile.fastValidation
      ? staleValidation(profile.fastValidation, aiProfileFingerprint({
        provider,
        apiUrl: profile.fastApiUrl ?? profile.apiUrl ?? undefined,
        model: profile.fastModel ?? undefined,
        profileArgs: profile.fastProfileArgs ?? profile.profileArgs,
        thinkingLevel: profile.fastThinkingLevel ?? undefined,
        serviceTier: profile.fastServiceTier,
        secretVersion: profile.secretVersion,
        purpose: "fast",
      }))
      : undefined,
  }, provider);
}

function normalizeSearchProfileValidation(provider: SearchProviderId, profile: SearchProviderProfile): SearchProviderProfile {
  return compactSearchProfile({
    ...profile,
    validation: profile.validation
      ? staleValidation(profile.validation, searchProfileFingerprint({
        provider,
        url: profile.url ?? undefined,
        mode: profile.mode,
        secretVersion: profile.secretVersion,
      }))
      : undefined,
  });
}

function compactProfile(profile: AiProviderProfile, provider: string): AiProviderProfile {
  return {
    ...stringField("apiUrl", profile.apiUrl),
    ...stringField("model", profile.model),
    ...(normalizeProfileArgs(provider, profile.profileArgs) ? { profileArgs: normalizeProfileArgs(provider, profile.profileArgs) } : {}),
    ...(thinkingLevel(profile.thinkingLevel) ? { thinkingLevel: thinkingLevel(profile.thinkingLevel) } : {}),
    ...(serviceTier(profile.serviceTier) ? { serviceTier: serviceTier(profile.serviceTier) } : {}),
    ...stringField("fastApiUrl", profile.fastApiUrl),
    ...stringField("fastModel", profile.fastModel),
    ...(normalizeProfileArgs(provider, profile.fastProfileArgs) ? { fastProfileArgs: normalizeProfileArgs(provider, profile.fastProfileArgs) } : {}),
    ...(thinkingLevel(profile.fastThinkingLevel) ? { fastThinkingLevel: thinkingLevel(profile.fastThinkingLevel) } : {}),
    ...(serviceTier(profile.fastServiceTier) ? { fastServiceTier: serviceTier(profile.fastServiceTier) } : {}),
    ...(numberField(profile.secretVersion) !== undefined ? { secretVersion: numberField(profile.secretVersion) } : {}),
    ...(profile.validation ? { validation: normalizeValidation(profile.validation) } : {}),
    ...(profile.fastValidation ? { fastValidation: normalizeValidation(profile.fastValidation) } : {}),
  };
}

function compactSearchProfile(profile: SearchProviderProfile): SearchProviderProfile {
  const mode = profile.mode === "grok-subscription" || profile.mode === "api-key" || profile.mode === "anonymous"
    ? profile.mode
    : undefined;
  return {
    ...stringField("url", profile.url),
    ...(mode ? { mode } : {}),
    ...(numberField(profile.secretVersion) !== undefined ? { secretVersion: numberField(profile.secretVersion) } : {}),
    ...(profile.validation ? { validation: normalizeValidation(profile.validation) } : {}),
  };
}

function stringField<K extends string>(key: K, value: string | null | undefined): Partial<Record<K, string | null>> {
  if (value === null) return { [key]: null } as Partial<Record<K, string | null>>;
  const trimmed = value?.trim();
  return trimmed ? ({ [key]: trimmed } as Partial<Record<K, string | null>>) : {};
}

function numberField(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function thinkingLevel(value: unknown): AiThinkingLevel | undefined {
  return value === "none" || value === "minimal" || value === "low" || value === "medium"
    || value === "high" || value === "highest" ? value : undefined;
}

function serviceTier(value: unknown): AiServiceTier | undefined {
  return value === "auto" || value === "standard" || value === "flex" || value === "priority"
    ? value
    : undefined;
}

function sortedRecord(value: Readonly<Record<string, string>> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeValidation(value: ProviderValidationState): ProviderValidationState {
  const status = value.status === "valid" || value.status === "invalid" || value.status === "not-required"
    ? value.status
    : "unknown";
  return {
    status,
    ...(value.fingerprint ? { fingerprint: value.fingerprint } : {}),
    ...(value.validatedAt ? { validatedAt: value.validatedAt } : {}),
    ...(value.message !== undefined ? { message: value.message } : {}),
  };
}

function stableFingerprint(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
