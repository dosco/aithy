import { describe, expect, test } from "bun:test";
import { ensureStartupLocalModels } from "../src/runtime/startup/preflight";
import { activeStatus } from "../src/setup/status";

describe("startup local model preflight", () => {
  test("continues when default local inference models are available", async () => {
    const logs: string[] = [];
    const modelPaths = await ensureStartupLocalModels({
      log: (message) => logs.push(message),
      ensureRequiredLocalModels: async (input = {}) => {
        expect(input.includeChat).toBe(false);
        input.onStatus?.(activeStatus("local.embedding.download", "downloading local model", {
          loadedBytes: 512,
          totalBytes: 1024,
          progress: 0.5,
        }));
        return new Map([["embedding", "/tmp/embed.gguf"]]);
      },
    });

    expect(modelPaths.get("embedding")).toBe("/tmp/embed.gguf");
    expect(logs).toContain("[startup] checking default local inference models");
    expect(logs.some((line) => line.includes("downloading local model 50%"))).toBe(true);
    expect(logs.at(-1)).toBe("[startup] default local inference models ready");
  });

  test("fails before web startup when default local inference models cannot be prepared", async () => {
    const logs: string[] = [];
    await expect(ensureStartupLocalModels({
      log: (message) => logs.push(message),
      ensureRequiredLocalModels: async () => {
        throw new Error("download denied");
      },
    })).rejects.toThrow("download denied");

    expect(logs.at(-1)).toBe("[startup] default local inference models failed: download denied");
  });
});
