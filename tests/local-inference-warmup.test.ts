import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/events/bus";
import { DEFAULT_LOCAL_AGENT_MODEL_ID } from "../src/local-inference/manifest";
import { loadConfig } from "../src/config/env";
import { RuntimeStore } from "../src/runtime/runtime-store";
import { LocalInferenceWarmupGate } from "../src/runtime/services/agent/local-inference-warmup";
import type { warmLocalAgentCache } from "../src/local-inference/warmup";

describe("local inference warmup gate", () => {
  test("only logical worker 1 starts warmup", async () => {
    let calls = 0;
    const fixture = await makeFixture(async () => {
      calls += 1;
    });

    await fixture.gate.ensure(fixture.input(2));
    expect(calls).toBe(0);

    await fixture.gate.ensure(fixture.input(1));
    expect(calls).toBe(1);
    fixture.close();
  });

  test("other workers wait when worker 1 warmup is already running", async () => {
    let releaseWarmup: (() => void) | undefined;
    let calls = 0;
    const fixture = await makeFixture(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        releaseWarmup = resolve;
      });
    });
    let waited = false;

    const first = fixture.gate.ensure(fixture.input(1));
    const second = fixture.gate.ensure(fixture.input(2)).then(() => {
      waited = true;
    });

    await Promise.resolve();
    expect(waited).toBe(false);
    releaseWarmup?.();
    await Promise.all([first, second]);
    expect(waited).toBe(true);
    expect(calls).toBe(1);
    fixture.close();
  });

  test("failed warmup is retried by the next worker 1 run", async () => {
    let calls = 0;
    const fixture = await makeFixture(async () => {
      calls += 1;
      if (calls === 1) throw new Error("warmup failed");
    });

    await expect(fixture.gate.ensure(fixture.input(1))).rejects.toThrow("warmup failed");
    await fixture.gate.ensure(fixture.input(1));
    expect(calls).toBe(2);
    fixture.close();
  });
});

async function makeFixture(warm: typeof warmLocalAgentCache) {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-warmup-"));
  const runtimeStore = new RuntimeStore(path.join(root, "state.db"));
  runtimeStore.heartbeat("local-inference-worker", "ready", {
    required: true,
    ready: true,
    chatReady: true,
    modelId: DEFAULT_LOCAL_AGENT_MODEL_ID,
    baseUrl: "http://127.0.0.1:1234",
  });
  const events = new EventBus();
  const config = {
    ...loadConfig({}),
    aiProvider: "local",
    localAgentModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
    aiModel: DEFAULT_LOCAL_AGENT_MODEL_ID,
  };
  return {
    gate: new LocalInferenceWarmupGate(warm),
    input: (agentWorkerId: number) => ({
      config,
      context: { agentWorkerId },
      events,
      runtimeStore,
    }),
    close: () => runtimeStore.close(),
  };
}
