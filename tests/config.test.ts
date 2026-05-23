import { describe, expect, test } from "bun:test";
import { DEFAULT_SANDBOX_IMAGE, loadConfig } from "../src/config/env";
import { assertStartupConfig, fastAiConfigurationIssues, providerRequiresApiKey } from "../src/config/validate";
import {
  CUSTOM_OPENAI_PROVIDER,
  DEFAULT_OPENAI_MODEL,
  XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
  XAI_GROK_SUBSCRIPTION_PROVIDER,
} from "../src/agent/ai-providers";
import { DEFAULT_LOCAL_AGENT_MODEL_ID, LOCAL_AI_PROVIDER } from "../src/local-inference/manifest";
import { createSandboxProvider } from "../src/sandbox/create-provider";
import { DisabledSandboxProvider } from "../src/sandbox/disabled-provider";

describe("loadConfig", () => {
  test("defaults to Microsandbox with offline networking", () => {
    const config = loadConfig();
    expect(config.sandboxProvider).toBe("microsandbox");
    expect(config.sandboxImage).toBe(DEFAULT_SANDBOX_IMAGE);
    expect(config.sandboxCpus).toBe(1);
    expect(config.sandboxMemoryMb).toBe(512);
    expect(config.sandboxNetwork).toBe("none");
    expect(config.parallelAgents).toBe(3);
    expect(config.parallelSearchMcpUrl).toBe("https://search.parallel.ai/mcp");
    expect(config.parallelApiKey).toBeUndefined();
    expect(config.systemBashEnabled).toBe(true);
    expect(config.aiProvider).toBe("openai");
    expect(config.aiModel).toBe(DEFAULT_OPENAI_MODEL);
    expect(config.localAgentModel).toBe(DEFAULT_LOCAL_AGENT_MODEL_ID);
    expect(config.botId).toBe("default");
    expect(config.stateDbPath.endsWith("/.config/aithy/default/state.db")).toBe(true);
  });

  test("ignores process-sourced config-shaped values", () => {
    const config = loadConfig({
      AITHY_AI_PROVIDER: "anthropic",
      AITHY_AI_MODEL: "gpt-4.1-mini",
      AITHY_AI_API_KEY: "sk-test",
      AITHY_FAST_AI_PROVIDER: "openai",
      AITHY_FAST_AI_MODEL: "gpt-4.1-nano",
      AITHY_FAST_AI_API_KEY: "sk-fast",
      AITHY_SYSTEM_BASH_ENABLED: "false",
      AITHY_SANDBOX_PROVIDER: "disabled",
      AITHY_SANDBOX_IMAGE: "ubuntu:24.04",
      AITHY_SANDBOX_CPUS: "2",
      AITHY_SANDBOX_MEMORY_MB: "1024",
      AITHY_SANDBOX_NETWORK: "public",
      AITHY_BOT_ID: "team bot",
      AITHY_STATE_DIR: "/tmp/aithy-state",
      AITHY_PARALLEL_SEARCH_MCP_URL: "https://search.example.test/mcp",
      AITHY_PARALLEL_API_KEY: "pk-aithy",
      OPENAI_API_KEY: "sk-openai",
      PARALLEL_API_KEY: "pk-fallback",
    } as never);
    expect(config.aiProvider).toBe("openai");
    expect(config.aiModel).toBe(DEFAULT_OPENAI_MODEL);
    expect(config.aiApiKey).toBeUndefined();
    expect(config.fastAiProvider).toBeUndefined();
    expect(config.fastAiModel).toBeUndefined();
    expect(config.fastAiApiKey).toBeUndefined();
    expect(config.systemBashEnabled).toBe(true);
    expect(config.sandboxProvider).toBe("microsandbox");
    expect(config.sandboxImage).toBe(DEFAULT_SANDBOX_IMAGE);
    expect(config.sandboxCpus).toBe(1);
    expect(config.sandboxMemoryMb).toBe(512);
    expect(config.sandboxNetwork).toBe("none");
    expect(config.botId).toBe("default");
    expect(config.stateDbPath.endsWith("/.config/aithy/default/state.db")).toBe(true);
    expect(config.parallelSearchMcpUrl).toBe("https://search.parallel.ai/mcp");
    expect(config.parallelApiKey).toBeUndefined();
  });

  test("creates disabled sandbox provider for disabled mode", () => {
    const provider = createSandboxProvider({ ...loadConfig(), sandboxProvider: "disabled" });

    expect(provider).toBeInstanceOf(DisabledSandboxProvider);
  });

  test("fresh hosted startup requires a provider API key", () => {
    expect(() => assertStartupConfig(loadConfig())).toThrow(/provider API key/);
  });

  test("accepts Local without a provider API key", () => {
    expect(() => assertStartupConfig({
      ...loadConfig(),
      aiProvider: LOCAL_AI_PROVIDER,
      aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
    })).not.toThrow();
  });

  test("rejects hosted startup without explicit AI model and credentials", () => {
    expect(() => assertStartupConfig({
      ...loadConfig(),
      aiProvider: "openai",
      aiModel: undefined,
    })).toThrow(/model/);
    expect(() => assertStartupConfig({
      ...loadConfig(),
      aiProvider: "openai",
      aiModel: "gpt-test",
    })).toThrow(/provider API key/);
  });

  test("exposes provider API key requirements for setup UI", () => {
    expect(providerRequiresApiKey("openai")).toBe(true);
    expect(providerRequiresApiKey("ollama")).toBe(false);
    expect(providerRequiresApiKey(LOCAL_AI_PROVIDER)).toBe(false);
    expect(providerRequiresApiKey(XAI_GROK_SUBSCRIPTION_PROVIDER)).toBe(false);
  });

  test("requires Grok subscription sign-in before using the subscription provider", () => {
    expect(() => assertStartupConfig({
      ...loadConfig(),
      aiProvider: XAI_GROK_SUBSCRIPTION_PROVIDER,
      aiModel: XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
    })).toThrow(/Grok subscription sign-in/);

    expect(() => assertStartupConfig({
      ...loadConfig(),
      aiProvider: XAI_GROK_SUBSCRIPTION_PROVIDER,
      aiModel: XAI_GROK_SUBSCRIPTION_DEFAULT_MODEL,
      grokSubscriptionConnected: true,
    })).not.toThrow();
  });

  test("reports incomplete fast AI provider settings", () => {
    expect(fastAiConfigurationIssues({
      ...loadConfig(),
      fastAiProvider: "openai",
      fastAiModel: "gpt-fast",
    })).toEqual(["fast provider API key"]);
  });

  test("accepts startup with model and provider credentials", () => {
    const config = {
      ...loadConfig(),
      aiProvider: "openai",
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    };
    expect(() => assertStartupConfig(config)).not.toThrow();
  });

  test("requires custom OpenAI provider base URL", () => {
    const missingUrl = {
      ...loadConfig(),
      aiProvider: CUSTOM_OPENAI_PROVIDER,
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    };
    expect(() => assertStartupConfig(missingUrl)).toThrow(/base URL/);

    expect(() => assertStartupConfig({
      ...missingUrl,
      aiApiUrl: "https://api.example.test/v1",
    })).not.toThrow();
  });
});
