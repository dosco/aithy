import { rm } from "node:fs/promises";
import { AX_AI_PROVIDERS } from "../agent/ai-providers";
import { deleteProviderApiKey } from "../settings/secrets";

export async function clearManagedProviderSecrets(botId: string): Promise<void> {
  await Promise.allSettled(
    AX_AI_PROVIDERS.map((provider) => deleteProviderApiKey(provider, botId)),
  );
}

export async function removeSqliteFiles(dbPath: string): Promise<void> {
  await Promise.all([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
  ]);
}
