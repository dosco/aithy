import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteArtifactStore } from "../src/artifacts/artifact-store";
import { normalizeRunOutboxPath } from "../src/artifacts/paths";
import { mimeTypeForPath, previewForFile } from "../src/artifacts/preview";
import { serveArtifactRequest } from "../src/artifacts/serve";

describe("artifact outbox paths", () => {
  const runOutbox = "/outbox/sessions/conversation/runs/run-1";

  test("normalizes supported run outbox path forms", () => {
    expect(normalizeRunOutboxPath("report.md", runOutbox)).toEqual({
      sandboxPath: `${runOutbox}/report.md`,
      relativePath: "sessions/conversation/runs/run-1/report.md",
    });
    expect(normalizeRunOutboxPath(`${runOutbox}/nested/report.md`, runOutbox)).toEqual({
      sandboxPath: `${runOutbox}/nested/report.md`,
      relativePath: "sessions/conversation/runs/run-1/nested/report.md",
    });
  });

  test("rejects paths outside the outbox or with traversal", () => {
    expect(() => normalizeRunOutboxPath("/outbox/sessions/other/runs/run-2/report.md", runOutbox)).toThrow("current run");
    expect(() => normalizeRunOutboxPath("../secret.txt", runOutbox)).toThrow("Path traversal");
    expect(() => normalizeRunOutboxPath("/workspace/outbox/report.md", runOutbox)).toThrow("New artifacts");
  });
});

describe("SqliteArtifactStore", () => {
  test("publishes, reads, serves, and deletes live outbox artifacts", async () => {
    const { store, outbox } = await artifactStore();
    const runOutbox = "/outbox/sessions/conversation/runs/run-1";
    await writeOutbox(outbox, "sessions/conversation/runs/run-1/report.md", "# Report\n\nhello");

    const artifact = await store.publish({
      sessionId: "conversation",
      runId: "run-1",
      runOutboxPath: runOutbox,
      path: "report.md",
      title: "Weekly report",
      description: "Generated report",
    });

    expect(artifact).toMatchObject({
      sessionId: "conversation",
      runId: "run-1",
      sandboxPath: `${runOutbox}/report.md`,
      relativePath: "sessions/conversation/runs/run-1/report.md",
      title: "Weekly report",
      description: "Generated report",
      filename: "report.md",
      mimeType: "text/markdown; charset=utf-8",
      previewKind: "text",
      textPreview: "# Report\n\nhello",
      openUrl: `/api/artifacts/${artifact.id}`,
      downloadUrl: `/api/artifacts/${artifact.id}?download=1`,
    });
    expect(store.get(artifact.id)).toMatchObject({ title: "Weekly report" });

    await writeOutbox(outbox, "sessions/conversation/runs/run-1/report.md", "updated");
    const served = await serveArtifactRequest(
      new Request(`http://127.0.0.1/api/artifacts/${artifact.id}`),
      store,
      artifact.id,
    );
    expect(served.status).toBe(200);
    expect(served.headers.get("content-disposition")).toContain("inline");
    expect(await served.text()).toBe("updated");

    const download = await serveArtifactRequest(
      new Request(`http://127.0.0.1/api/artifacts/${artifact.id}?download=1`),
      store,
      artifact.id,
    );
    expect(download.headers.get("content-disposition")).toContain("attachment");

    await rm(path.join(outbox, "sessions/conversation/runs/run-1/report.md"));
    const missing = await serveArtifactRequest(
      new Request(`http://127.0.0.1/api/artifacts/${artifact.id}`),
      store,
      artifact.id,
    );
    expect(missing.status).toBe(404);
    expect(store.delete(artifact.id)).toBe(true);
    expect(store.get(artifact.id)).toBeNull();
    store.close();
  });

  test("rejects symlinks and classifies image, binary, and large text previews", async () => {
    const { store, outbox } = await artifactStore();
    const runOutbox = "/outbox/sessions/c/runs/run-1";
    await writeOutbox(outbox, "sessions/c/runs/run-1/image.png", "not really a png");
    await writeOutbox(outbox, "sessions/c/runs/run-1/file.pdf", "%PDF");
    await writeOutbox(outbox, "sessions/c/runs/run-1/large.txt", "x".repeat(70 * 1024));
    const secret = path.join(outbox, "secret.txt");
    await Bun.write(secret, "secret");
    await symlink(secret, path.join(outbox, "sessions/c/runs/run-1/link.txt"));

    const base = { sessionId: "c", runId: "run-1", runOutboxPath: runOutbox };
    await expect(store.publish({ ...base, path: "link.txt" }))
      .rejects.toThrow("symlink");
    await expect(store.publish({ ...base, path: "image.png" }))
      .resolves.toMatchObject({ previewKind: "image", mimeType: "image/png" });
    await expect(store.publish({ ...base, path: "file.pdf" }))
      .resolves.toMatchObject({ previewKind: "download", mimeType: "application/pdf" });
    await expect(store.publish({ ...base, path: "large.txt" }))
      .resolves.toMatchObject({ previewKind: "download", textPreview: null });
    store.close();
  });
});

describe("artifact previews", () => {
  test("detects MIME types and falls back to download for invalid text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-artifact-preview-"));
    const file = path.join(root, "bad.json");
    await Bun.write(file, new Uint8Array([0xff, 0xfe, 0xfd]));

    expect(mimeTypeForPath("data.json")).toBe("application/json; charset=utf-8");
    await expect(previewForFile(file, "application/json; charset=utf-8", 3))
      .resolves.toEqual({ previewKind: "download", textPreview: null });
  });
});

async function artifactStore() {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-artifacts-"));
  const workspace = path.join(root, "workspace");
  const outbox = path.join(root, "outbox");
  await mkdir(outbox, { recursive: true });
  const store = new SqliteArtifactStore(path.join(root, "state.db"), workspace, outbox);
  return { store, workspace, outbox };
}

async function writeOutbox(outbox: string, relativePath: string, content: string) {
  const file = path.join(outbox, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, content);
}
