import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isAiConfigured } from "../../src/config/validate";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { parallelWebSearch } from "../../src/search/parallel-search-client";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import {
  deleteParallelApiKey,
  deleteProviderApiKey,
  normalizePostedSecret,
  writeParallelApiKey,
  writeProviderApiKey,
} from "../../src/settings/secrets";
import type { RuntimeSettings } from "../../src/settings/types";
import { parallelSearchTestInput, settingsInput } from "./action-schemas";
import { assertPrimaryAiSettings } from "./ai-settings-test";
import {
  configDto,
  parallelSearchStatus,
  secretStatus,
  secretStatusForProvider,
} from "./dto";

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
    await assertPrimaryAiSettings(runtime.config, { ...data, runtime: runtimePatch });

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
      parallelSearch: await parallelSearchStatus(runtime.config, settings),
      aiConfigured: isAiConfigured(runtime.config),
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
    const result = await parallelWebSearch(
      {
        query: data.query,
        task: "Verify Aithy public web search settings.",
      },
      { url, apiKey },
    );
    return {
      provider: result.provider,
      mode: apiKey ? "api-key" : "anonymous",
      url,
      answer: result.answer,
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
