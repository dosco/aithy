import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isCustomOpenAIProvider } from "../../src/agent/ai-providers";
import { isAiConfigured } from "../../src/config/validate";
import {
  logoutGrokSubscription,
  pollGrokSubscriptionLogin,
  startGrokSubscriptionLogin,
} from "../../src/grok-subscription/login";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { webSearch } from "../../src/search/web-search-provider";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import {
  deleteParallelApiKey,
  deleteProviderApiKey,
  normalizePostedSecret,
  writeParallelApiKey,
  writeProviderApiKey,
} from "../../src/settings/secrets";
import type { RuntimeSettings } from "../../src/settings/types";
import {
  grokSubscriptionLoginPollInput,
  localInferenceSettingsInput,
  parallelSearchTestInput,
  settingsInput,
} from "./action-schemas";
import { assertAiSettings } from "./ai-settings-test";
import {
  configDto,
  grokSubscriptionStatusDto,
  parallelSearchStatus,
  secretStatus,
  secretStatusForProvider,
} from "./dto";
import { setupGateStateDto } from "./web-state.dto";

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator(settingsInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const provider = data.runtime?.aiProvider?.trim() || runtime.config.aiProvider;
    const apiKey = normalizePostedSecret(data.apiKey);
    const fastProvider = data.runtime?.fastAiProvider?.trim();
    const fastApiKey = normalizePostedSecret(data.fastApiKey);
    const parallelApiKey = normalizePostedSecret(data.parallelApiKey);

    let runtimePatch: RuntimeSettings | undefined = data.runtime;
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
    await assertAiSettings(runtime.config, { ...data, runtime: runtimePatch });

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
      config: configDto(runtime.config),
      secret: await secretStatus(runtime.config, settings),
      fastSecret: runtime.config.fastAiProvider
        ? runtime.config.fastAiProvider === runtime.config.aiProvider
          ? await secretStatus(runtime.config, settings)
          : await secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId)
        : null,
      grokSubscription: await grokSubscriptionStatusDto(runtime.config),
      parallelSearch: await parallelSearchStatus(runtime.config, settings),
      aiConfigured: isAiConfigured(runtime.config),
      setupGate: setupGateStateDto(runtime),
      skippedPaths,
    };
  });

export const testParallelSearch = createServerFn({ method: "POST" })
  .inputValidator(parallelSearchTestInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const apiKey = normalizePostedSecret(data.apiKey) ?? runtime.config.parallelApiKey;
    const url = normalizeParallelSearchMcpUrl(data.url ?? runtime.config.parallelSearchMcpUrl);
    const result = await webSearch(
      {
        query: data.query,
        task: "Verify Aithy public web search settings.",
      },
      { ...runtime.config, parallelSearchMcpUrl: url, parallelApiKey: apiKey },
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
  .inputValidator(grokSubscriptionLoginPollInput)
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
  .inputValidator(localInferenceSettingsInput)
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
      config: configDto(runtime.config),
      setupGate: setupGateStateDto(runtime),
    };
  });

async function prepareGlobalMounts(
  input: Array<{ hostPath: string }>,
  workspaceRoot: string,
): Promise<{ mounts: Array<{ hostPath: string }>; skippedPaths: string[] }> {
  const seen = new Set<string>();
  const out: Array<{ hostPath: string }> = [];
  const skippedPaths: string[] = [];
  const normWorkspace = path.resolve(workspaceRoot);
  for (const entry of input) {
    const raw = entry.hostPath.trim();
    if (!raw) continue;
    const expanded = expandHome(raw);
    if (!path.isAbsolute(expanded)) throw new Error(`Mount path must be absolute: ${raw}`);
    const resolved = path.resolve(expanded);
    if (resolved === "/workspace" || resolved === "/cache") throw new Error(`Cannot mount reserved path: ${resolved}`);
    const rel = path.relative(normWorkspace, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new Error(`Cannot mount a path inside the workspace root: ${resolved}`);
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ hostPath: resolved });
    try {
      await stat(resolved);
    } catch {
      skippedPaths.push(resolved);
    }
  }
  return { mounts: out, skippedPaths };
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

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
    config: configDto(runtime.config),
    secret: await secretStatus(runtime.config, settings),
    fastSecret: runtime.config.fastAiProvider
      ? runtime.config.fastAiProvider === runtime.config.aiProvider
        ? await secretStatus(runtime.config, settings)
        : await secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId)
      : null,
    parallelSearch: await parallelSearchStatus(runtime.config, settings),
    aiConfigured: isAiConfigured(runtime.config),
    setupGate: setupGateStateDto(runtime),
  };
}
