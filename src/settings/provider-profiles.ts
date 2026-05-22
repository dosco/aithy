import { createHash } from "node:crypto";
import { isCustomOpenAIProvider, isLocalAiProvider, isXaiGrokSubscriptionProvider } from "../agent/ai-providers";
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

export function providerUsesApiUrl(provider: string): boolean {
  return isCustomOpenAIProvider(provider);
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
  secretVersion?: number;
  purpose?: "primary" | "fast";
}): string {
  return stableFingerprint({
    kind: "llm",
    provider: input.provider,
    apiUrl: input.apiUrl ?? "",
    model: input.model ?? "",
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
    [provider]: compactProfile({ ...aiProfileFor(settings, provider), ...patch }),
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
    profiles[provider] = compactProfile(profile);
  }
  if (runtime.aiProvider) {
    profiles[runtime.aiProvider] = compactProfile({
      ...(profiles[runtime.aiProvider] ?? {}),
      ...(runtime.aiApiUrl !== undefined ? { apiUrl: runtime.aiApiUrl } : {}),
      ...(runtime.aiModel !== undefined ? { model: runtime.aiModel } : {}),
    });
  }
  if (runtime.fastAiProvider) {
    profiles[runtime.fastAiProvider] = compactProfile({
      ...(profiles[runtime.fastAiProvider] ?? {}),
      ...(runtime.fastAiApiUrl !== undefined ? { fastApiUrl: runtime.fastAiApiUrl } : {}),
      ...(runtime.fastAiModel !== undefined ? { fastModel: runtime.fastAiModel } : {}),
    });
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
        secretVersion: profile.secretVersion,
        purpose: "primary",
      }))
      : undefined,
    fastValidation: profile.fastValidation
      ? staleValidation(profile.fastValidation, aiProfileFingerprint({
        provider,
        apiUrl: profile.fastApiUrl ?? profile.apiUrl ?? undefined,
        model: profile.fastModel ?? undefined,
        secretVersion: profile.secretVersion,
        purpose: "fast",
      }))
      : undefined,
  });
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

function compactProfile(profile: AiProviderProfile): AiProviderProfile {
  return {
    ...stringField("apiUrl", profile.apiUrl),
    ...stringField("model", profile.model),
    ...stringField("fastApiUrl", profile.fastApiUrl),
    ...stringField("fastModel", profile.fastModel),
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
