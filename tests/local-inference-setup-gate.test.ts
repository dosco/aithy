import { describe, expect, test } from "bun:test";
import { setupGateStateDto } from "../app/server/web-state.dto";
import { loadConfig } from "../src/config/env";
import { DEFAULT_LOCAL_AGENT_MODEL_ID, LOCAL_AI_PROVIDER } from "../src/local-inference/manifest";
import type { RuntimeServiceStatus } from "../src/runtime/protocol/types";

describe("local inference setup gate", () => {
  test("blocks when Local is active and the worker is not ready", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
      service: null,
    }));

    expect(state.localInferenceRequired).toBe(true);
    expect(state.localInferenceReady).toBe(false);
    expect(state.localInferenceActive).toBe(true);
  });

  test("does not gate hosted providers on local chat readiness", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: "openai",
        aiModel: "gpt-test",
        aiApiKey: "sk-test",
      },
      service: null,
    }));

    expect(state.aiConfigured).toBe(true);
    expect(state.localInferenceRequired).toBe(false);
    expect(state.localInferenceReady).toBe(true);
    expect(state.localInferenceActive).toBe(false);
  });

  test("blocks when fast Local is active and chat is not ready", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: "openai",
        aiModel: "gpt-test",
        aiApiKey: "sk-test",
        fastAiProvider: LOCAL_AI_PROVIDER,
        fastAiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
      service: null,
    }));

    expect(state.localInferenceRequired).toBe(true);
    expect(state.localInferenceReady).toBe(false);
    expect(state.localInferenceActive).toBe(true);
  });

  test("blocks local inference before profile setup is complete", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
      service: null,
      profileName: "",
    }));

    expect(state.profileConfigured).toBe(false);
    expect(state.localInferenceRequired).toBe(true);
    expect(state.localInferenceReady).toBe(false);
    expect(state.localInferenceActive).toBe(true);
  });

  test("blocks when the ready worker is serving a different local model", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: "hf:example/next:next.gguf",
        localAgentModel: "hf:example/next:next.gguf",
      },
      service: {
        role: "local-inference-worker",
        state: "ready",
        pid: 123,
        lastSeenAt: new Date().toISOString(),
        detail: {
          required: true,
          ready: true,
          chatReady: true,
          modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
          baseUrl: "http://127.0.0.1:1234",
        },
      },
    }));

    expect(state.localInferenceRequired).toBe(true);
    expect(state.localInferenceReady).toBe(false);
    expect(state.localInferenceActive).toBe(true);
  });

  test("does not trust a stale ready heartbeat after restart", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
      service: {
        role: "local-inference-worker",
        state: "ready",
        pid: 123,
        lastSeenAt: new Date(Date.now() - 60_000).toISOString(),
        detail: {
          required: true,
          ready: true,
          chatReady: true,
          modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
          baseUrl: "http://127.0.0.1:1234",
        },
      },
    }));

    expect(state.localInferenceRequired).toBe(true);
    expect(state.localInferenceReady).toBe(false);
    expect(state.localInferenceActive).toBe(true);
  });

  test("shows degraded local inference errors without marking setup active", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
      service: {
        role: "local-inference-worker",
        state: "degraded",
        pid: 123,
        lastSeenAt: new Date().toISOString(),
        detail: {
          required: true,
          ready: false,
          error: "llama-server was not found",
        },
      },
    }));

    expect(state.localInferenceReady).toBe(false);
    expect(state.localInferenceActive).toBe(false);
    expect(state.localInferenceError).toBe("llama-server was not found");
  });

  test("router readiness is not enough when Local chat is selected", () => {
    const state = setupGateStateDto(fakeRuntime({
      config: {
        ...loadConfig({}),
        aiProvider: LOCAL_AI_PROVIDER,
        aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      },
      service: {
        role: "local-inference-worker",
        state: "ready",
        pid: 123,
        lastSeenAt: new Date().toISOString(),
        detail: {
          required: true,
          ready: true,
          chatReady: false,
          modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
          baseUrl: "http://127.0.0.1:1234",
        },
      },
    }));

    expect(state.localInferenceRequired).toBe(true);
    expect(state.localInferenceReady).toBe(false);
    expect(state.localInferenceActive).toBe(true);
  });
});

function fakeRuntime(input: {
  config: ReturnType<typeof loadConfig>;
  service: RuntimeServiceStatus | null;
  profileName?: string;
}) {
  return {
    config: input.config,
    profile: { userName: input.profileName ?? "User" },
    runtimeStore: { service: () => input.service },
  } as any;
}
