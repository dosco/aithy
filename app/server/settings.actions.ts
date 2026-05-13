import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isAiConfigured } from "../../src/config/validate";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import {
  deleteProviderApiKey,
  normalizePostedSecret,
  writeProviderApiKey,
} from "../../src/settings/secrets";
import { settingsInput } from "./action-schemas";
import { assertPrimaryAiSettings } from "./ai-settings-test";
import { configDto, secretStatus, secretStatusForProvider } from "./dto";

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator(settingsInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const provider = data.runtime?.aiProvider?.trim() || runtime.config.aiProvider;
    const apiKey = normalizePostedSecret(data.apiKey);
    const fastProvider = data.runtime?.fastAiProvider?.trim();
    const fastApiKey = normalizePostedSecret(data.fastApiKey);

    let runtimePatch = data.runtime;
    if (apiKey && !data.clearApiKey) runtimePatch = { ...(runtimePatch ?? {}), aiApiKey: undefined };
    if (data.clearApiKey) runtimePatch = { ...(runtimePatch ?? {}), aiApiKey: null };
    if (data.clearAiModel) runtimePatch = { ...(runtimePatch ?? {}), aiModel: null };
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

    const settings = await runtime.updateSettings({ runtime: runtimePatch, ui: data.ui }, { apiKey, fastApiKey });
    return {
      settings,
      config: configDto(runtime.config),
      secret: await secretStatus(runtime.config, settings),
      fastSecret: runtime.config.fastAiProvider
        ? runtime.config.fastAiProvider === runtime.config.aiProvider
          ? await secretStatus(runtime.config, settings)
          : await secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId)
        : null,
      aiConfigured: isAiConfigured(runtime.config),
      skippedPaths,
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
