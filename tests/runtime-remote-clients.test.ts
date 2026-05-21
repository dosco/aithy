import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { RuntimeStore } from "../src/runtime/runtime-store";
import { RemoteEmbedder, RemoteReranker } from "../src/runtime/services/embedding/client";
import { SandboxCommandClient, SandboxServiceUnavailableError } from "../src/runtime/services/sandbox/client";

describe("runtime remote clients", () => {
  test("sandbox bash throws typed state error when service is not ready", async () => {
    const store = await makeStore();
    store.heartbeat("sandbox-worker", "starting", { message: "booting VM" });
    const client = new SandboxCommandClient(store);

    expect(() => client.bash("s1", { command: "echo hi" })).toThrow(SandboxServiceUnavailableError);
    store.close();
  });

  test("sandbox bash becomes a runtime command", async () => {
    const store = await makeStore();
    store.heartbeat("sandbox-worker", "ready");
    const client = new SandboxCommandClient(store);
    setTimeout(() => {
      const [command] = store.claimPendingCommands("sandbox-worker");
      expect(command.kind).toBe("sandbox.bash");
      store.completeCommand(command.id, "completed", {
        ok: true,
        result: { exitCode: 0, stdout: "hi\n", stderr: "", timedOut: false },
      });
    }, 10).unref();

    await expect(client.bash("s1", { command: "echo hi" })).resolves.toMatchObject({ stdout: "hi\n" });
    store.close();
  });

  test("remote embed and rerank commands complete cleanly", async () => {
    const store = await makeStore();
    store.heartbeat("local-inference-worker", "ready");
    const embedder = new RemoteEmbedder(store);
    const reranker = new RemoteReranker(store);
    setTimeout(() => completeEmbeddingCommands(store), 10).unref();

    const vectors = await embedder.embedMany(["hello"]);
    expect(Array.from(vectors[0])).toEqual([1, 2, 3]);
    await expect(embedder.embedQuery("hello")).resolves.toEqual(new Float32Array([4, 5, 6]));
    await expect(reranker.rerank("hello", ["doc"])).resolves.toEqual([0.7]);
    store.close();
  });
});

async function makeStore(): Promise<RuntimeStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-runtime-client-"));
  return new RuntimeStore(path.join(dir, "state.db"));
}

function completeEmbeddingCommands(store: RuntimeStore): void {
  const timer = setInterval(() => {
    const [command] = store.claimPendingCommands("local-inference-worker");
    if (!command) return;
    if (command.kind === "embedding.embedMany") {
      store.completeCommand(command.id, "completed", { ok: true, result: { vectors: [[1, 2, 3]] } });
    }
    if (command.kind === "embedding.embedQuery") {
      store.completeCommand(command.id, "completed", { ok: true, result: { vector: [4, 5, 6] } });
    }
    if (command.kind === "embedding.rerank") {
      store.completeCommand(command.id, "completed", { ok: true, result: { scores: [0.7] } });
      clearInterval(timer);
    }
  }, 5);
  timer.unref();
}
