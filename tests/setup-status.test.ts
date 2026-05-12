import { describe, expect, test } from "bun:test";
import {
  createPullProgressTracker,
  transformerProgressStatus,
} from "../src/setup/status";

describe("setup status translators", () => {
  test("converts Transformers.js progress into model download status", () => {
    const status = transformerProgressStatus(
      "memory.embedder",
      "memory model",
      "Xenova/all-MiniLM-L6-v2",
      {
        status: "progress",
        progress: 50,
        loaded: 10,
        total: 20,
      },
    );

    expect(status).toMatchObject({
      key: "memory.embedder",
      label: "downloading memory model Xenova/all-MiniLM-L6-v2",
      active: true,
      progress: 0.5,
      loadedBytes: 10,
      totalBytes: 20,
    });
  });

  test("converts Microsandbox pull progress into image download status", () => {
    const statusFor = createPullProgressTracker("python:3.11-slim");
    const status = statusFor({
      kind: "layerDownloadProgress",
      layerIndex: 0,
      downloadedBytes: 25,
      totalBytes: 100,
      totalDownloadBytes: 100,
    });

    expect(status).toMatchObject({
      key: "sandbox",
      label: "downloading sandbox image python:3.11-slim",
      active: true,
      progress: 0.25,
      loadedBytes: 25,
      totalBytes: 100,
    });
  });

  test("converts Microsandbox materialization into filesystem setup status", () => {
    const statusFor = createPullProgressTracker("python:3.11-slim");

    expect(statusFor({ kind: "layerMaterializeStarted" })).toMatchObject({
      key: "sandbox",
      label: "preparing sandbox filesystem",
      active: true,
    });
  });
});
