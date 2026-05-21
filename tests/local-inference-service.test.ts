import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { warmLocalAgentCache } from "../src/local-inference/warmup";
import { progressFetch } from "../src/local-inference/download";
import { DEFAULT_LOCAL_AGENT_MODEL, LOCAL_CHAT_MODEL_ALIAS } from "../src/local-inference/manifest";
import { renderLlamaModelsIni } from "../src/local-inference/models-ini";
import { cleanupStaleLlamaRouter, loadAndWarmRouter } from "../src/local-inference/router";
import { defaultLocalInferenceSettings } from "../src/local-inference/settings";
import { chatDependenciesForServices } from "../src/runtime/services/queue/runtime";
import type { RuntimeServiceRole, RuntimeServiceStatus } from "../src/runtime/protocol/types";

describe("local inference service integration", () => {
  test("models.ini omits the chat alias when local chat is disabled", () => {
    const ini = renderLlamaModelsIni(defaultLocalInferenceSettings, {
      embedding: "/models/embed.gguf",
      reranker: "/models/rerank.gguf",
    });

    expect(ini).not.toContain(`[${LOCAL_CHAT_MODEL_ALIAS}]`);
    expect(ini).not.toContain("model = /models/chat.gguf");
    expect(ini).toContain("[Qwen3-Embedding-0.6B]");
    expect(ini).toContain("pooling = last");
    expect(ini).toContain("[Qwen3-Reranker-0.6B]");
    expect(ini).toContain("pooling = rank");
  });

  test("models.ini includes the chat alias when local chat is enabled", () => {
    const ini = renderLlamaModelsIni(defaultLocalInferenceSettings, {
      chat: "/models/chat.gguf",
      embedding: "/models/embed.gguf",
      reranker: "/models/rerank.gguf",
    });

    expect(ini).toContain(`[${LOCAL_CHAT_MODEL_ALIAS}]`);
    expect(ini).toContain("model = /models/chat.gguf");
    expect(ini).toContain("ctx-size = 32768");
    expect(ini).toContain("chat-template-kwargs = {\"enable_thinking\":true}");
  });

  test("router warmup loads and probes embedding and reranker by default", async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, body });
      if (url.endsWith("/models?reload=1")) {
        return Response.json({
          data: [
            { id: "Qwen3-Embedding-0.6B", status: { value: "loaded" } },
            { id: "Qwen3-Reranker-0.6B", status: { value: "loaded" } },
          ],
        });
      }
      if (url.endsWith("/v1/embeddings")) {
        return Response.json({ data: [{ embedding: [0, 1] }] });
      }
      if (url.endsWith("/v1/rerank")) {
        return Response.json({ results: [{ index: 0, relevance_score: 1 }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "Hello." } }] });
      }
      return Response.json({ success: true });
    };

    await loadAndWarmRouter({
      baseUrl: "http://127.0.0.1:1234",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(requests.map((request) => request.body?.model).filter(Boolean)).toEqual([
      "Qwen3-Embedding-0.6B",
      "Qwen3-Reranker-0.6B",
      "Qwen3-Embedding-0.6B",
      "Qwen3-Reranker-0.6B",
    ]);
  });

  test("router warmup loads and probes chat when local chat is included", async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, body });
      if (url.endsWith("/models?reload=1")) {
        return Response.json({
          data: [
            { id: LOCAL_CHAT_MODEL_ALIAS, status: { value: "loaded" } },
            { id: "Qwen3-Embedding-0.6B", status: { value: "loaded" } },
            { id: "Qwen3-Reranker-0.6B", status: { value: "loaded" } },
          ],
        });
      }
      if (url.endsWith("/v1/embeddings")) {
        return Response.json({ data: [{ embedding: [0, 1] }] });
      }
      if (url.endsWith("/v1/rerank")) {
        return Response.json({ results: [{ index: 0, relevance_score: 1 }] });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "Hello." } }] });
      }
      return Response.json({ success: true });
    };

    await loadAndWarmRouter({
      baseUrl: "http://127.0.0.1:1234",
      includeChat: true,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(requests.map((request) => request.body?.model).filter(Boolean)).toEqual([
      LOCAL_CHAT_MODEL_ALIAS,
      "Qwen3-Embedding-0.6B",
      "Qwen3-Reranker-0.6B",
      "Qwen3-Embedding-0.6B",
      "Qwen3-Reranker-0.6B",
      LOCAL_CHAT_MODEL_ALIAS,
    ]);
  });

  test("download progress keeps the model total stable across chunk fetches", async () => {
    const originalFetch = globalThis.fetch;
    const reports: Array<{ loadedBytes?: number; totalBytes?: number; progress?: number }> = [];
    let calls = 0;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return new Response("{}", { headers: { "x-linked-size": "5000000" } });
      }
      return new Response(oneChunkStream(2_000_000), {
        headers: { "content-length": "2000000" },
      });
    }) as typeof fetch;

    try {
      const wrapped = progressFetch(
        DEFAULT_LOCAL_AGENT_MODEL,
        (status) => reports.push(status),
        "local.chat.download",
      );
      await wrapped("https://example.test/info", { headers: { Range: "bytes=0-0" } });
      await (await wrapped("https://example.test/chunk-1", { headers: { Range: "bytes=0-1999999" } })).arrayBuffer();
      await (await wrapped("https://example.test/chunk-2", { headers: { Range: "bytes=2000000-3999999" } })).arrayBuffer();
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(reports.map((status) => status.totalBytes)).toEqual([
      5_000_000,
      5_000_000,
      5_000_000,
      5_000_000,
    ]);
    expect(reports.at(-1)).toMatchObject({
      loadedBytes: 4_000_000,
      progress: 0.8,
    });
  });

  test("warmup sends a no-session hello chat completion", async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      return Response.json({
        choices: [{ message: { content: "Hello." } }],
      });
    };

    await warmLocalAgentCache({
      baseUrl: "http://127.0.0.1:1234",
      modelId: "Qwen3.5-4B",
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "http://127.0.0.1:1234/v1/chat/completions",
      body: {
        model: "Qwen3.5-4B",
        messages: [
          expect.objectContaining({ role: "system" }),
          { role: "user", content: "hello" },
        ],
        stream: false,
      },
    });
  });

  test("chat queue shows local inference as a blocking dependency when local chat is required", async () => {
    const services = new Map<RuntimeServiceRole, RuntimeServiceStatus>([
      service("sandbox-worker", "ready"),
      service(
        "local-inference-worker",
        "starting",
        {
          required: true,
          ready: false,
          modelId: "hf:example/model:model.gguf",
        },
      ),
    ]);

    expect(chatDependenciesForServices(services)).toEqual([
      "sandbox-worker",
      "local-inference-worker",
    ]);

    services.set("local-inference-worker", service("local-inference-worker", "ready", {
      required: true,
      ready: true,
    })[1]);
    expect(chatDependenciesForServices(services)).toEqual([
      "sandbox-worker",
      "local-inference-worker",
    ]);
  });

  test("chat queue drops local inference when the service reports it is not required", async () => {
    const services = new Map<RuntimeServiceRole, RuntimeServiceStatus>([
      service("sandbox-worker", "ready"),
      service("local-inference-worker", "ready", {
        required: false,
        ready: true,
      }),
    ]);

    expect(chatDependenciesForServices(services)).toEqual(["sandbox-worker"]);
  });

  test("chat queue does not block on local inference before a non-local heartbeat", async () => {
    const services = new Map<RuntimeServiceRole, RuntimeServiceStatus>([
      service("sandbox-worker", "ready"),
    ]);

    expect(chatDependenciesForServices(services)).toEqual(["sandbox-worker"]);
  });

  test("stale router cleanup terminates a matching llama-server marker", async () => {
    const markerPath = await tempMarker({
      pid: 456,
      port: 9876,
      binaryPath: "/bin/llama-server",
      modelsIniPath: "/tmp/aithy/models.ini",
    });
    const signals: Array<NodeJS.Signals | 0> = [];
    const result = await cleanupStaleLlamaRouter(markerPath, {
      inspectCommand: async () => "/bin/llama-server --models-preset /tmp/aithy/models.ini --port 9876",
      kill: (_pid, signal) => {
        signals.push(signal);
        return signal === "SIGTERM";
      },
      sleep: async () => undefined,
    });

    expect(result).toEqual({ status: "killed", pid: 456 });
    expect(signals).toEqual(["SIGTERM", 0]);
    await expect(readFile(markerPath, "utf8")).rejects.toThrow();
  });

  test("stale router cleanup refuses to kill a reused unrelated pid", async () => {
    const markerPath = await tempMarker({
      pid: 456,
      port: 9876,
      binaryPath: "/bin/llama-server",
      modelsIniPath: "/tmp/aithy/models.ini",
    });
    const signals: Array<NodeJS.Signals | 0> = [];
    const result = await cleanupStaleLlamaRouter(markerPath, {
      inspectCommand: async () => "node unrelated.js",
      kill: (_pid, signal) => {
        signals.push(signal);
        return true;
      },
    });

    expect(result).toEqual({ status: "unmatched", pid: 456 });
    expect(signals).toEqual([]);
    await expect(readFile(markerPath, "utf8")).resolves.toContain("/bin/llama-server");
  });

  test("stale router cleanup refuses a port substring match", async () => {
    const markerPath = await tempMarker({
      pid: 456,
      port: 9876,
      binaryPath: "/bin/llama-server",
      modelsIniPath: "/tmp/aithy/models.ini",
    });
    const signals: Array<NodeJS.Signals | 0> = [];
    const result = await cleanupStaleLlamaRouter(markerPath, {
      inspectCommand: async () => "/bin/llama-server --models-preset /tmp/aithy/models.ini --port 98765",
      kill: (_pid, signal) => {
        signals.push(signal);
        return true;
      },
    });

    expect(result).toEqual({ status: "unmatched", pid: 456 });
    expect(signals).toEqual([]);
    await expect(readFile(markerPath, "utf8")).resolves.toContain("/bin/llama-server");
  });
});

function oneChunkStream(size: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
}

function service(
  role: RuntimeServiceRole,
  state: RuntimeServiceStatus["state"],
  detail: unknown = null,
): [RuntimeServiceRole, RuntimeServiceStatus] {
  return [role, {
    role,
    state,
    detail,
    pid: 123,
    lastSeenAt: new Date().toISOString(),
  }];
}

async function tempMarker(input: {
  pid: number;
  port: number;
  binaryPath: string;
  modelsIniPath: string;
}): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-router-marker-"));
  const markerPath = path.join(dir, "router.json");
  await writeFile(markerPath, JSON.stringify({
    ...input,
    baseUrl: `http://127.0.0.1:${input.port}`,
    startedAt: new Date().toISOString(),
    workerPid: 123,
  }));
  return markerPath;
}
