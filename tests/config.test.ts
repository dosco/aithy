import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { assertStartupConfig } from "../src/config/validate";
import { createSandboxProvider } from "../src/sandbox/create-provider";
import { DisabledSandboxProvider } from "../src/sandbox/disabled-provider";

describe("loadConfig", () => {
  test("defaults to Microsandbox with offline networking", () => {
    const config = loadConfig({});
    expect(config.sandboxProvider).toBe("microsandbox");
    expect(config.sandboxImage).toBe("python:3.11-slim");
    expect(config.sandboxCpus).toBe(1);
    expect(config.sandboxMemoryMb).toBe(512);
    expect(config.sandboxNetwork).toBe("none");
    expect(config.parallelAgents).toBe(3);
    expect(config.parallelSearchMcpUrl).toBe("https://search.parallel.ai/mcp");
    expect(config.parallelApiKey).toBeUndefined();
    expect(config.systemBashEnabled).toBe(true);
    expect(config.botId).toBe("default");
    expect(config.stateDbPath.endsWith("/.config/aithy/default/state.db")).toBe(true);
  });

  test("parses system bash feature override", () => {
    expect(loadConfig({ AITHY_SYSTEM_BASH_ENABLED: "false" }).systemBashEnabled).toBe(false);
    expect(loadConfig({ AITHY_SYSTEM_BASH_ENABLED: "0" }).systemBashEnabled).toBe(false);
    expect(loadConfig({ AITHY_SYSTEM_BASH_ENABLED: "true" }).systemBashEnabled).toBe(true);
  });

  test("supports disabled sandbox override", () => {
    const config = loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" });
    expect(config.sandboxProvider).toBe("disabled");
  });

  test("maps legacy mock sandbox override to disabled", () => {
    const config = loadConfig({ AITHY_SANDBOX_PROVIDER: "mock" });
    expect(config.sandboxProvider).toBe("disabled");
  });

  test("ignores AI model and provider env vars", () => {
    const config = loadConfig({
      AITHY_AI_PROVIDER: "anthropic",
      AITHY_AI_MODEL: "gpt-4.1-mini",
      AITHY_AI_API_KEY: "sk-test",
      OPENAI_API_KEY: "sk-openai",
    });
    expect(config.aiProvider).toBe("openai");
    expect(config.aiModel).toBeUndefined();
    expect(config.aiApiKey).toBeUndefined();
  });

  test("ignores fast AI env vars", () => {
    const config = loadConfig({
      AITHY_FAST_AI_PROVIDER: "openai",
      AITHY_FAST_AI_MODEL: "gpt-4.1-nano",
      AITHY_FAST_AI_API_KEY: "sk-fast",
    });
    expect(config.fastAiProvider).toBeUndefined();
    expect(config.fastAiModel).toBeUndefined();
    expect(config.fastAiApiKey).toBeUndefined();
  });

  test("parses Microsandbox resource overrides", () => {
    const config = loadConfig({
      AITHY_SANDBOX_IMAGE: "ubuntu:24.04",
      AITHY_SANDBOX_CPUS: "2",
      AITHY_SANDBOX_MEMORY_MB: "1024",
      AITHY_SANDBOX_NETWORK: "public",
    });
    expect(config.sandboxImage).toBe("ubuntu:24.04");
    expect(config.sandboxCpus).toBe(2);
    expect(config.sandboxMemoryMb).toBe(1024);
    expect(config.sandboxNetwork).toBe("public");
  });

  test("creates disabled sandbox provider for disabled mode", () => {
    const provider = createSandboxProvider(loadConfig({ AITHY_SANDBOX_PROVIDER: "disabled" }));

    expect(provider).toBeInstanceOf(DisabledSandboxProvider);
  });

  test("parses state overrides", () => {
    const config = loadConfig({
      AITHY_BOT_ID: "team bot",
      AITHY_STATE_DIR: "/tmp/aithy-state",
    });
    expect(config.botId).toBe("team-bot");
    expect(config.stateDir).toBe("/tmp/aithy-state");
    expect(config.stateDbPath).toBe("/tmp/aithy-state/team-bot/state.db");
    expect(config.outboxRoot).toBe("/tmp/aithy-state/team-bot/outbox");
  });

  test("parses Parallel search overrides", () => {
    const config = loadConfig({
      AITHY_PARALLEL_SEARCH_MCP_URL: " https://search.example.test/mcp ",
      PARALLEL_API_KEY: " pk-fallback ",
    });
    expect(config.parallelSearchMcpUrl).toBe("https://search.example.test/mcp");
    expect(config.parallelApiKey).toBe("pk-fallback");

    const preferred = loadConfig({
      AITHY_PARALLEL_API_KEY: " pk-aithy ",
      PARALLEL_API_KEY: " pk-fallback ",
    });
    expect(preferred.parallelApiKey).toBe("pk-aithy");
  });

  test("rejects startup without explicit AI model and credentials", () => {
    expect(() => assertStartupConfig(loadConfig({}))).toThrow(/model/);
    expect(() => assertStartupConfig({
      ...loadConfig({}),
      aiModel: "gpt-test",
    })).toThrow(/provider API key/);
  });

  test("accepts startup with model and provider credentials", () => {
    const config = {
      ...loadConfig({}),
      aiModel: "gpt-test",
      aiApiKey: "sk-test",
    };
    expect(() => assertStartupConfig(config)).not.toThrow();
  });
});
