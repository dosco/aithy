import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isCustomOpenAIProvider } from "../../src/agent/ai-providers";
import type { AppConfig } from "../../src/config/env";
import { isAiConfigured } from "../../src/config/validate";
import { isMeshInferenceProvider, isMeshSearchProvider } from "../../src/mesh/types";
import { logoutGrokSubscription, pollGrokSubscriptionLogin, startGrokSubscriptionLogin } from "../../src/grok-subscription/login";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { webSearch } from "../../src/search/web-search-provider";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import {
  activeSearchProvider,
  aiProfileFingerprint,
  aiProfileFor,
  providerNeedsLiveValidation,
  searchProfileFingerprint,
  searchProfileFor,
  upsertAiProfile,
  upsertSearchProfile,
  validValidation,
  validationNotRequired,
} from "../../src/settings/provider-profiles";
import {
  deleteParallelApiKey,
  deleteProviderApiKey,
  normalizePostedSecret,
  writeParallelApiKey,
  writeProviderApiKey,
} from "../../src/settings/secrets";
import type { RuntimeSettings } from "../../src/settings/types";
import { grokSubscriptionLoginPollInput, localInferenceSettingsInput, parallelSearchTestInput, settingsInput } from "./action-schemas";
import { assertAiSettings } from "./ai-settings-test";
import {
  configDto,
  grokSubscriptionStatusDto,
  parallelSearchStatus,
  providerSecretStatuses,
  secretStatus,
  secretStatusForProvider,
} from "./dto";
import { prepareGlobalMounts } from "./settings-mounts";
import { normalizeMcpProfile } from "../../src/mcp/profile";
import { setupGateStateDto } from "./web-state.dto";

export const saveSettings = createServerFn({ method: "POST" })
  .validator(settingsInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const currentSettings = runtime.settings.load();
    const provider = data.runtime?.aiProvider?.trim() || runtime.config.aiProvider;
    const apiKey = normalizePostedSecret(data.apiKey);
    const fastProvider = data.runtime?.fastAiProvider?.trim();
    const fastApiKey = normalizePostedSecret(data.fastApiKey);
    const parallelApiKey = normalizePostedSecret(data.parallelApiKey);

    let runtimePatch: RuntimeSettings | undefined = data.runtime as RuntimeSettings | undefined;
    if (apiKey && !data.clearApiKey) runtimePatch = { ...(runtimePatch ?? {}), aiApiKey: undefined };
    if (data.clearApiKey) runtimePatch = { ...(runtimePatch ?? {}), aiApiKey: null };
    if (data.clearAiModel) runtimePatch = { ...(runtimePatch ?? {}), aiModel: null };
    if (runtimePatch?.aiApiUrl !== undefined) {
      runtimePatch = {
        ...runtimePatch,
        aiApiUrl: isCustomOpenAIProvider(provider)
          ? normalizeOpenAiApiUrl(runtimePatch.aiApiUrl)
          : null,
      };
    }
    if (runtimePatch?.fastAiApiUrl !== undefined) {
      runtimePatch = {
        ...runtimePatch,
        fastAiApiUrl: fastProvider && isCustomOpenAIProvider(fastProvider)
          ? normalizeOpenAiApiUrl(runtimePatch.fastAiApiUrl)
          : null,
      };
    }
    if (parallelApiKey && !data.clearParallelApiKey) {
      runtimePatch = { ...(runtimePatch ?? {}), parallelApiKey: undefined };
    }
    if (data.clearParallelApiKey) {
      runtimePatch = { ...(runtimePatch ?? {}), parallelApiKey: null };
    }
    if (runtimePatch?.parallelSearchMcpUrl !== undefined) {
      runtimePatch = {
        ...runtimePatch,
        parallelSearchMcpUrl: runtimePatch.parallelSearchMcpUrl === null
          ? null
          : normalizeParallelSearchMcpUrl(runtimePatch.parallelSearchMcpUrl),
      };
    }
    if (runtimePatch?.mcpServers) {
      runtimePatch = { ...runtimePatch, mcpServers: Object.fromEntries(Object.entries(runtimePatch.mcpServers)
        .map(([id, profile]) => [id, normalizeMcpProfile(id, profile)])) };
    }
    await assertMeshAiSelection(runtime, currentSettings.runtime, runtimePatch, provider, fastProvider);
    await assertAiSettings(runtime.config, { ...data, runtime: runtimePatch });
    runtimePatch = markValidatedAiProfiles(currentSettings.runtime, runtimePatch, {
      provider,
      apiKeyChanged: Boolean(apiKey || data.clearApiKey),
      fastProvider,
      fastApiKeyChanged: Boolean(fastApiKey || data.clearFastApiKey),
    });
    if (isSearchPatch(runtimePatch, data.parallelApiKey, data.clearParallelApiKey)) {
      const searchProvider = runtimePatch?.searchProvider ?? activeSearchProvider(currentSettings.runtime);
      if (isMeshSearchProvider(searchProvider)) await runtime.mesh.validateSearchSelection(searchProvider);
      else {
        await assertSearchSettings(runtime.config, currentSettings.runtime, runtimePatch, {
          parallelApiKey,
          clearParallelApiKey: data.clearParallelApiKey,
        });
      }
      runtimePatch = markValidatedSearchProfile(currentSettings.runtime, runtimePatch, {
        parallelApiKey,
        clearParallelApiKey: data.clearParallelApiKey,
        hasParallelApiKey: Boolean(parallelApiKey || (!data.clearParallelApiKey && runtime.config.parallelApiKey)),
      });
    }

    let skippedPaths: string[] = [];
    if (runtimePatch?.globalMounts) {
      const result = await prepareGlobalMounts(runtimePatch.globalMounts, runtime.config.workspaceRoot);
      runtimePatch = { ...runtimePatch, globalMounts: result.mounts };
      skippedPaths = result.skippedPaths;
    }
    if (apiKey) await writeProviderApiKey(provider, apiKey, runtime.config.botId);
    if (data.clearApiKey) await deleteProviderApiKey(provider, runtime.config.botId);
    if (fastProvider && fastApiKey) await writeProviderApiKey(fastProvider, fastApiKey, runtime.config.botId);
    if (data.clearFastApiKey && fastProvider) await deleteProviderApiKey(fastProvider, runtime.config.botId);
    if (parallelApiKey) await writeParallelApiKey(parallelApiKey, runtime.config.botId);
    if (data.clearParallelApiKey) await deleteParallelApiKey(runtime.config.botId);

    const settings = await runtime.updateSettings(
      { runtime: runtimePatch, ui: data.ui },
      { apiKey, fastApiKey, parallelApiKey },
    );
    return {
      settings,
      config: configDto(runtime.config, settings),
      secret: await secretStatus(runtime.config, settings),
      fastSecret: runtime.config.fastAiProvider
        ? runtime.config.fastAiProvider === runtime.config.aiProvider
          ? await secretStatus(runtime.config, settings)
          : await secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId, settings)
        : null,
      providerSecrets: await providerSecretStatuses(runtime.config, settings),
      grokSubscription: await grokSubscriptionStatusDto(runtime.config),
      parallelSearch: await parallelSearchStatus(runtime.config, settings),
      aiConfigured: isAiConfigured(runtime.config),
      setupGate: setupGateStateDto(runtime),
      skippedPaths,
    };
  });

export const testParallelSearch = createServerFn({ method: "POST" })
  .validator(parallelSearchTestInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const apiKey = normalizePostedSecret(data.apiKey) ?? runtime.config.parallelApiKey;
    const url = normalizeParallelSearchMcpUrl(data.url ?? runtime.config.parallelSearchMcpUrl);
    const provider = (data.provider ?? runtime.config.searchProvider) as AppConfig["searchProvider"];
    const result = await webSearch(
      {
        query: data.query,
        task: "Verify Aithy public web search settings.",
      },
      { ...runtime.config, searchProvider: provider, parallelSearchMcpUrl: url, parallelApiKey: apiKey },
    );
    return {
      provider: result.provider,
      mode: result.provider === "grok-subscription" ? "grok-subscription" : apiKey ? "api-key" : "anonymous",
      url,
      answer: result.answer,
    };
  });

export const startGrokSubscriptionSignIn = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    return startGrokSubscriptionLogin({
      botId: runtime.config.botId,
      stateDbPath: runtime.config.stateDbPath,
    });
  });

export const pollGrokSubscriptionSignIn = createServerFn({ method: "POST" })
  .validator(grokSubscriptionLoginPollInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const result = await pollGrokSubscriptionLogin(data.loginId);
    if (result.state !== "signing_in") {
      await runtime.updateSettings({});
    }
    return grokSubscriptionActionState(runtime, result.loginId, result.state, result.message);
  });

export const logoutGrokSubscriptionSignIn = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const status = await logoutGrokSubscription({
      botId: runtime.config.botId,
      stateDbPath: runtime.config.stateDbPath,
    });
    await runtime.updateSettings({});
    return {
      ...(await grokSubscriptionActionState(runtime, "", status.state, status.message ?? "Signed out of Grok.")),
      status,
    };
  });

export const saveLocalInferenceSettings = createServerFn({ method: "POST" })
  .validator(localInferenceSettingsInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const settings = await runtime.updateSettings({
      runtime: {
        localAgentModel: data.localAgentModel,
        ...(data.localInference ? { localInference: data.localInference } : {}),
      },
    });
    return {
      settings,
      config: configDto(runtime.config, settings),
      setupGate: setupGateStateDto(runtime),
    };
  });

function normalizeParallelSearchMcpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Parallel Search MCP URL is required.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Parallel Search MCP URL must be a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Parallel Search MCP URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Parallel Search MCP URL must not include embedded credentials.");
  }
  return url.href;
}

function normalizeOpenAiApiUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("Custom OpenAI base URL is required.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Custom OpenAI base URL must be a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Custom OpenAI base URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Custom OpenAI base URL must not include embedded credentials.");
  }
  return url.href;
}

async function assertMeshAiSelection(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  current: RuntimeSettings,
  patch: RuntimeSettings | undefined,
  provider: string,
  fastProvider?: string,
): Promise<void> {
  if (isMeshInferenceProvider(provider)) {
    const model = patch?.aiModel ?? aiProfileFor(current, provider).model ?? runtime.config.aiModel;
    await runtime.mesh.validateInferenceSelection(provider, model ?? "");
  }
  if (fastProvider && isMeshInferenceProvider(fastProvider)) {
    const profile = aiProfileFor(current, fastProvider);
    const model = patch?.fastAiModel ?? profile.fastModel ?? runtime.config.fastAiModel;
    await runtime.mesh.validateInferenceSelection(fastProvider, model ?? "");
  }
}

function markValidatedAiProfiles(
  current: RuntimeSettings,
  patch: RuntimeSettings | undefined,
  input: {
    provider: string;
    apiKeyChanged: boolean;
    fastProvider?: string;
    fastApiKeyChanged: boolean;
  },
): RuntimeSettings | undefined {
  if (!patch) return patch;
  let profiles = patch.aiProviderProfiles ?? current.aiProviderProfiles ?? {};
  const currentProfile = aiProfileFor(current, input.provider);
  const secretVersion = nextSecretVersion(currentProfile.secretVersion, input.apiKeyChanged);
  const apiUrl = patch.aiApiUrl === null ? null : patch.aiApiUrl ?? currentProfile.apiUrl;
  const model = patch.aiModel === null ? null : patch.aiModel ?? currentProfile.model;
  const fingerprint = aiProfileFingerprint({
    provider: input.provider,
    apiUrl: apiUrl ?? undefined,
    model: model ?? undefined,
    secretVersion,
    purpose: "primary",
  });
  profiles = upsertAiProfile({ ...current, aiProviderProfiles: profiles }, input.provider, {
    ...(patch.aiApiUrl !== undefined ? { apiUrl } : {}),
    ...(patch.aiModel !== undefined ? { model } : {}),
    secretVersion,
    validation: providerNeedsLiveValidation(input.provider)
      ? validValidation(fingerprint)
      : validationNotRequired(),
  });
  if (input.fastProvider) {
    const currentFastProfile = aiProfileFor({ ...current, aiProviderProfiles: profiles }, input.fastProvider);
    const fastSecretVersion = nextSecretVersion(currentFastProfile.secretVersion, input.fastApiKeyChanged);
    const fastApiUrl = patch.fastAiApiUrl === null ? null : patch.fastAiApiUrl ?? currentFastProfile.fastApiUrl;
    const fastModel = patch.fastAiModel ?? currentFastProfile.fastModel;
    const effectiveFastApiUrl = fastApiUrl ?? currentFastProfile.apiUrl;
    const fastFingerprint = aiProfileFingerprint({
      provider: input.fastProvider,
      apiUrl: effectiveFastApiUrl ?? undefined,
      model: fastModel ?? undefined,
      secretVersion: input.fastProvider === input.provider ? secretVersion : fastSecretVersion,
      purpose: "fast",
    });
    profiles = upsertAiProfile({ ...current, aiProviderProfiles: profiles }, input.fastProvider, {
      ...(patch.fastAiApiUrl !== undefined ? { fastApiUrl } : {}),
      ...(patch.fastAiModel !== undefined ? { fastModel } : {}),
      secretVersion: input.fastProvider === input.provider ? secretVersion : fastSecretVersion,
      fastValidation: providerNeedsLiveValidation(input.fastProvider)
        ? validValidation(fastFingerprint)
        : validationNotRequired(),
    });
  }
  return { ...patch, aiProviderProfiles: profiles };
}

async function assertSearchSettings(
  config: AppConfig,
  current: RuntimeSettings,
  patch: RuntimeSettings | undefined,
  input: {
    parallelApiKey?: string;
    clearParallelApiKey?: boolean;
  },
): Promise<void> {
  const provider = patch?.searchProvider ?? activeSearchProvider(current);
  const profile = searchProfileFor(current, provider);
  const url = provider === "parallel"
    ? normalizeParallelSearchMcpUrl((patch?.parallelSearchMcpUrl ?? profile.url ?? config.parallelSearchMcpUrl) || "")
    : config.parallelSearchMcpUrl;
  const apiKey = input.clearParallelApiKey ? undefined : input.parallelApiKey ?? config.parallelApiKey;
  await webSearch(
    {
      query: "Aithy settings validation",
      task: "Verify Aithy public web search settings.",
    },
    {
      ...config,
      searchProvider: provider,
      parallelSearchMcpUrl: url,
      parallelApiKey: apiKey,
    },
  );
}

function markValidatedSearchProfile(
  current: RuntimeSettings,
  patch: RuntimeSettings | undefined,
  input: {
    parallelApiKey?: string;
    clearParallelApiKey?: boolean;
    hasParallelApiKey: boolean;
  },
): RuntimeSettings | undefined {
  if (!patch) return patch;
  const provider = patch.searchProvider ?? activeSearchProvider(current);
  if (isMeshSearchProvider(provider)) {
    return {
      ...patch,
      searchProvider: provider,
      searchProviderProfiles: upsertSearchProfile(current, provider, {
        validation: validationNotRequired("Validated against the live family catalog."),
      }),
    };
  }
  const currentProfile = searchProfileFor(current, provider);
  const secretVersion = nextSecretVersion(currentProfile.secretVersion, Boolean(input.parallelApiKey || input.clearParallelApiKey));
  const mode = provider === "grok-subscription"
    ? "grok-subscription"
    : input.clearParallelApiKey
      ? "anonymous"
      : input.parallelApiKey
        ? "api-key"
      : currentProfile.mode ?? (input.hasParallelApiKey ? "api-key" : "anonymous");
  const url = provider === "parallel"
    ? patch.parallelSearchMcpUrl ?? currentProfile.url
    : currentProfile.url;
  const fingerprint = searchProfileFingerprint({
    provider,
    url: url ?? undefined,
    mode,
    secretVersion,
  });
  return {
    ...patch,
    searchProvider: provider,
    searchProviderProfiles: upsertSearchProfile(current, provider, {
      ...(url !== undefined ? { url } : {}),
      mode,
      secretVersion,
      validation: validValidation(fingerprint),
    }),
  };
}

function isSearchPatch(
  patch: RuntimeSettings | undefined,
  parallelApiKey: string | undefined,
  clearParallelApiKey: boolean | undefined,
): boolean {
  return Boolean(
    patch?.searchProvider !== undefined
      || patch?.parallelSearchMcpUrl !== undefined
      || parallelApiKey
      || clearParallelApiKey,
  );
}

function nextSecretVersion(current: number | undefined, changed: boolean): number {
  return Math.max(0, Math.floor(current ?? 0)) + (changed ? 1 : 0);
}

async function grokSubscriptionActionState(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  loginId: string,
  state: Awaited<ReturnType<typeof grokSubscriptionStatusDto>>["state"],
  message: string,
) {
  const settings = runtime.settings.load();
  return {
    loginId,
    state,
    message,
    status: await grokSubscriptionStatusDto(runtime.config),
    settings,
    config: configDto(runtime.config, settings),
    secret: await secretStatus(runtime.config, settings),
    fastSecret: runtime.config.fastAiProvider
      ? runtime.config.fastAiProvider === runtime.config.aiProvider
        ? await secretStatus(runtime.config, settings)
        : await secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId, settings)
      : null,
    providerSecrets: await providerSecretStatuses(runtime.config, settings),
    parallelSearch: await parallelSearchStatus(runtime.config, settings),
    aiConfigured: isAiConfigured(runtime.config),
    setupGate: setupGateStateDto(runtime),
  };
}
