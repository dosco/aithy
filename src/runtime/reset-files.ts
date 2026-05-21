import { rm } from "node:fs/promises";
import { sandboxNameFor } from "../sandbox/sandbox-name";
import { AX_AI_PROVIDERS } from "../agent/ai-providers";
import { deleteGrokSubscriptionTokens } from "../grok-subscription/store";
import { deleteProviderApiKey } from "../settings/secrets";

export async function clearManagedProviderSecrets(botId: string): Promise<void> {
  await Promise.allSettled(
    [
      ...AX_AI_PROVIDERS.map((provider) => deleteProviderApiKey(provider, botId)),
      deleteGrokSubscriptionTokens(botId),
    ],
  );
}

export async function removeSqliteFiles(dbPath: string): Promise<void> {
  await Promise.all([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
  ]);
}

export async function removeRuntimeCache(cacheDir: string): Promise<void> {
  await rm(cacheDir, { force: true, recursive: true });
}

export async function removeBotStateDir(stateDir: string, botId: string): Promise<void> {
  await rm(`${stateDir}/${botId}`, { force: true, recursive: true });
}

export async function removeMicrosandboxVm(botId: string): Promise<void> {
  try {
    const { Sandbox } = await import("microsandbox");
    await Sandbox.remove(sandboxNameFor(botId));
  } catch {
    // Best-effort cleanup. Fresh start should keep going even if the sandbox
    // runtime or local record is already gone.
  }
}
