import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { DEFAULT_LOCAL_AGENT_MODEL_ID, LOCAL_AI_PROVIDER, LOCAL_CHAT_MODEL_ALIAS } from "../src/local-inference/manifest";
import { resolveLocalInferenceConfig } from "../src/runtime/local-inference-config";

describe("local inference runtime config", () => {
  test("maps Local to the ready worker endpoint for the selected model", () => {
    const config = {
      ...loadConfig({}),
      aiProvider: LOCAL_AI_PROVIDER,
      aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      localAgentModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
    };
    const resolved = resolveLocalInferenceConfig(config, fakeStore({
      ready: true,
      modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
      baseUrl: "http://127.0.0.1:1234",
    }));

    expect(resolved.aiApiUrl).toBe("http://127.0.0.1:1234/v1");
    expect(resolved.aiApiKey).toBe("local");
    expect(resolved.aiModel).toBe(LOCAL_CHAT_MODEL_ALIAS);
  });

  test("rejects a ready router before local chat is loaded", () => {
    const config = {
      ...loadConfig({}),
      aiProvider: LOCAL_AI_PROVIDER,
      aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
      localAgentModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
    };

    expect(() => resolveLocalInferenceConfig(config, fakeStore({
      ready: true,
      chatReady: false,
      modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
      baseUrl: "http://127.0.0.1:1234",
    }))).toThrow(/not ready/);
  });

  test("rejects a ready worker that is serving a stale local model", () => {
    const config = {
      ...loadConfig({}),
      aiProvider: LOCAL_AI_PROVIDER,
      aiModel: "hf:example/next:next.gguf",
      localAgentModel: "hf:example/next:next.gguf",
    };

    expect(() => resolveLocalInferenceConfig(config, fakeStore({
      ready: true,
      modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
      baseUrl: "http://127.0.0.1:1234",
    }))).toThrow(/not ready/);
  });
});

function fakeStore(detail: { ready: boolean; chatReady?: boolean; modelId: string; baseUrl: string }) {
  return {
    service: () => ({
      role: "local-inference-worker",
      state: detail.ready ? "ready" : "starting",
      pid: 123,
      lastSeenAt: new Date().toISOString(),
      detail: {
        required: true,
        ready: detail.ready,
        chatReady: detail.chatReady ?? detail.ready,
        modelId: detail.modelId,
        baseUrl: detail.baseUrl,
      },
    }),
  } as any;
}
