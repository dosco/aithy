import { rm } from "node:fs/promises";
import { AX_AI_PROVIDERS } from "../agent/ai-providers";
import { deleteProviderApiKey } from "../settings/secrets";

export async function clearManagedProviderSecrets(): Promise<void> {
  await Promise.allSettled(
    AX_AI_PROVIDERS.map((provider) => deleteProviderApiKey(provider)),
  );
}

export async function removeSqliteFiles(dbPath: string): Promise<void> {
  await Promise.all([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
  ]);
}
