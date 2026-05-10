import { a as testAiChat } from "../../src/agent/ai-smoke-test";
import type { AppConfig } from "../../src/config/env";
import { normalizePostedSecret, readProviderApiKey } from "../../src/settings/secrets";
import type { RuntimeSettings } from "../../src/settings/types";

export interface AiSettingsTestInput {
  runtime?: RuntimeSettings;
  apiKey?: string;
  clearApiKey?: boolean;
  clearAiModel?: boolean;
}

export async function assertPrimaryAiSettings(
  config: AppConfig,
  input: AiSettingsTestInput,
): Promise<void> {
  if (input.clearApiKey || input.clearAiModel) return;
  const provider = input.runtime?.aiProvider?.trim() || config.aiProvider;
  const model = input.runtime?.aiModel?.trim() || config.aiModel;
  const apiKey = normalizePostedSecret(input.apiKey);
  if (!apiKey && provider === config.aiProvider && model === config.aiModel) return;

  const storedApiKey =
    provider === config.aiProvider ? config.aiApiKey : await readProviderApiKey(provider, config.botId);

  await testAiChat({
    ...config,
    aiProvider: provider,
    aiModel: model,
    aiApiKey: apiKey || storedApiKey,
  });
}
