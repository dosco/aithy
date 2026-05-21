import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { localModelDtos } from "../app/server/local-model-dtos";
import {
  hfRepoFolderName,
  listCachedGgufModels,
  managedLocalModelById,
  repoIdFromHfFolderName,
  resolveCachedLocalModelPath,
  resolveHfHubCacheDir,
} from "../src/local-inference/hf-cache";
import { ensureRequiredLocalModels } from "../src/local-inference/download";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_RERANKER_MODEL,
  MANAGED_LOCAL_CHAT_MODELS,
  localModelId,
} from "../src/local-inference/manifest";

describe("local inference Hugging Face cache", () => {
  test("resolves the standard HF Hub cache path precedence", () => {
    expect(resolveHfHubCacheDir("/home/me")).toBe("/home/me/.cache/huggingface/hub");
  });

  test("maps model repo ids to Hugging Face cache folder names", () => {
    expect(hfRepoFolderName("org/model")).toBe("models--org--model");
    expect(repoIdFromHfFolderName("models--org--model")).toBe("org/model");
    expect(repoIdFromHfFolderName("datasets--org--dataset")).toBeNull();
  });

  test("lists managed downloadable Qwen chat models by size", () => {
    expect(MANAGED_LOCAL_CHAT_MODELS.map((model) => model.label)).toEqual([
      "Qwen3.5 4B Q5_K_M",
      "Qwen3.5 9B Q5_K_M",
    ]);
    for (const model of MANAGED_LOCAL_CHAT_MODELS) {
      expect(managedLocalModelById(model.id)).toBe(model);
    }
  });

  test("web model DTOs include uncached managed chat models with labels", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "aithy-hf-cache-"));
    const models = await localModelDtos(cacheDir);
    expect(models.slice(0, 2).map((model) => ({
      displayName: model.displayName,
      cached: model.cached,
      managed: model.managed,
    }))).toEqual([
      { displayName: "Qwen3.5 4B Q5_K_M", cached: false, managed: true },
      { displayName: "Qwen3.5 9B Q5_K_M", cached: false, managed: true },
    ]);
  });

  test("lists cached GGUF models from snapshot folders", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "aithy-hf-cache-"));
    const repoId = "example/qwen";
    const filename = "nested/model.Q4_K_M.gguf";
    const snapshotDir = path.join(cacheDir, hfRepoFolderName(repoId), "snapshots", "abc123", "nested");
    await mkdir(snapshotDir, { recursive: true });
    await writeFile(path.join(snapshotDir, "model.Q4_K_M.gguf"), "gguf");

    const models = await listCachedGgufModels(cacheDir);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: localModelId(repoId, filename),
      repoId,
      filename,
      sizeBytes: 4,
      managed: false,
    });
    await expect(resolveCachedLocalModelPath(localModelId(repoId, filename), cacheDir))
      .resolves.toBe(path.join(snapshotDir, "model.Q4_K_M.gguf"));
  });

  test("lists Hugging Face snapshot symlinks that point at blob files", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "aithy-hf-cache-"));
    const repoId = "example/symlinked";
    const filename = "model.Q4_K_M.gguf";
    const repoRoot = path.join(cacheDir, hfRepoFolderName(repoId));
    const snapshotDir = path.join(repoRoot, "snapshots", "abc123");
    const blobDir = path.join(repoRoot, "blobs");
    const blobPath = path.join(blobDir, "blob123");
    await mkdir(snapshotDir, { recursive: true });
    await mkdir(blobDir, { recursive: true });
    await writeFile(blobPath, "gguf");
    await symlink(blobPath, path.join(snapshotDir, filename));

    const models = await listCachedGgufModels(cacheDir);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: localModelId(repoId, filename),
      path: path.join(snapshotDir, filename),
      sizeBytes: 4,
    });
  });

  test("resolves embedding and reranker without the chat model by default", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "aithy-hf-cache-"));
    await writeCachedModel(
      cacheDir,
      DEFAULT_LOCAL_EMBEDDING_MODEL.repoId,
      DEFAULT_LOCAL_EMBEDDING_MODEL.filename,
      "embedding",
    );
    await writeCachedModel(
      cacheDir,
      DEFAULT_LOCAL_RERANKER_MODEL.repoId,
      DEFAULT_LOCAL_RERANKER_MODEL.filename,
      "reranker",
    );

    const paths = await ensureRequiredLocalModels({ cacheDir });

    expect(paths.has("chat")).toBe(false);
    expect(paths.get("embedding")).toBe(cachedModelPath(
      cacheDir,
      DEFAULT_LOCAL_EMBEDDING_MODEL.repoId,
      DEFAULT_LOCAL_EMBEDDING_MODEL.filename,
    ));
    expect(paths.get("reranker")).toBe(cachedModelPath(
      cacheDir,
      DEFAULT_LOCAL_RERANKER_MODEL.repoId,
      DEFAULT_LOCAL_RERANKER_MODEL.filename,
    ));
  });

  test("resolves the selected chat model when local chat is included", async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), "aithy-hf-cache-"));
    const customRepoId = "example/custom-chat";
    const customFilename = "custom-chat.gguf";
    await writeCachedModel(cacheDir, customRepoId, customFilename, "chat");
    await writeCachedModel(
      cacheDir,
      DEFAULT_LOCAL_EMBEDDING_MODEL.repoId,
      DEFAULT_LOCAL_EMBEDDING_MODEL.filename,
      "embedding",
    );
    await writeCachedModel(
      cacheDir,
      DEFAULT_LOCAL_RERANKER_MODEL.repoId,
      DEFAULT_LOCAL_RERANKER_MODEL.filename,
      "reranker",
    );

    const paths = await ensureRequiredLocalModels({
      includeChat: true,
      cacheDir,
      chatModelId: localModelId(customRepoId, customFilename),
    });

    expect(paths.get("chat")).toBe(cachedModelPath(cacheDir, customRepoId, customFilename));
    expect(paths.get("embedding")).toBe(cachedModelPath(
      cacheDir,
      DEFAULT_LOCAL_EMBEDDING_MODEL.repoId,
      DEFAULT_LOCAL_EMBEDDING_MODEL.filename,
    ));
    expect(paths.get("reranker")).toBe(cachedModelPath(
      cacheDir,
      DEFAULT_LOCAL_RERANKER_MODEL.repoId,
      DEFAULT_LOCAL_RERANKER_MODEL.filename,
    ));
  });
});

async function writeCachedModel(
  cacheDir: string,
  repoId: string,
  filename: string,
  content: string,
): Promise<void> {
  const file = cachedModelPath(cacheDir, repoId, filename);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function cachedModelPath(cacheDir: string, repoId: string, filename: string): string {
  return path.join(cacheDir, hfRepoFolderName(repoId), "snapshots", "abc123", filename);
}
