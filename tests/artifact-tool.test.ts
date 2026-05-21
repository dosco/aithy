import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteArtifactStore } from "../src/artifacts/artifact-store";
import { createAgentTools } from "../src/agent/tools";
import { loadConfig } from "../src/config/env";
import { RuntimeStore } from "../src/runtime/runtime-store";
import { CapabilityBroker } from "../src/security/capability-broker";

describe("artifact.publish tool", () => {
  test("is registered, publishes from outbox, and writes capability audit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-artifact-tool-"));
    const workspace = path.join(root, "workspace");
    const outbox = path.join(root, "outbox");
    await mkdir(path.join(outbox, "sessions/conversation/runs/run-1"), { recursive: true });
    await Bun.write(path.join(outbox, "sessions/conversation/runs/run-1/note.txt"), "hello");
    const dbPath = path.join(root, "state.db");
    const runtimeStore = new RuntimeStore(dbPath);
    runtimeStore.ensureGrant("artifact.publish", "test grant");
    const artifacts = new SqliteArtifactStore(dbPath, workspace, outbox);
    const tool = createAgentTools({
      session: { conversationId: "conversation" },
      workspacePath: workspace,
      artifacts,
      artifactRunId: "run-1",
      artifactRunOutboxPath: "/outbox/sessions/conversation/runs/run-1",
      capabilities: new CapabilityBroker(runtimeStore),
    } as any, { ...loadConfig(), sandboxProvider: "disabled" })
      .find((item: any) => item.namespace === "artifact" && item.name === "publish") as any;

    expect(tool).toBeTruthy();
    const result = await tool.func({
      path: "note.txt",
      title: "Note",
      description: "A small note",
    });

    expect(result).toMatchObject({
      title: "Note",
      description: "A small note",
      runId: "run-1",
      sandboxPath: "/outbox/sessions/conversation/runs/run-1/note.txt",
      previewKind: "text",
      textPreview: "hello",
    });
    const db = new Database(dbPath);
    const audit = db
      .query("SELECT capability, tool_name, allowed FROM tool_audit_log")
      .get() as { capability: string; tool_name: string; allowed: number };
    expect(audit).toEqual({
      capability: "artifact.publish",
      tool_name: "artifact.publish",
      allowed: 1,
    });
    db.close();
    artifacts.close();
    runtimeStore.close();
  });
});

describe("artifact.write tool", () => {
  test("writes bare filenames to outbox, publishes, and writes capability audit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-artifact-write-tool-"));
    const workspace = path.join(root, "workspace");
    const outbox = path.join(root, "outbox");
    const dbPath = path.join(root, "state.db");
    const runtimeStore = new RuntimeStore(dbPath);
    runtimeStore.ensureGrant("artifact.write", "test grant");
    const artifacts = new SqliteArtifactStore(dbPath, workspace, outbox);
    const tool = createAgentTools({
      session: { conversationId: "conversation" },
      workspacePath: workspace,
      artifacts,
      artifactRunId: "run-1",
      artifactRunOutboxPath: "/outbox/sessions/conversation/runs/run-1",
      capabilities: new CapabilityBroker(runtimeStore),
    } as any, { ...loadConfig(), sandboxProvider: "disabled" })
      .find((item: any) => item.namespace === "artifact" && item.name === "write") as any;

    expect(tool).toBeTruthy();
    const result = await tool.func({
      path: "cat.txt",
      content: "Moonlit paws ascend\nWhiskers skim the silver clouds\nPurrs orbit the stars\n",
      title: "Cat Haiku",
    });

    expect(result).toMatchObject({
      title: "Cat Haiku",
      runId: "run-1",
      sandboxPath: "/outbox/sessions/conversation/runs/run-1/cat.txt",
      relativePath: "sessions/conversation/runs/run-1/cat.txt",
      previewKind: "text",
    });
    expect(await readFile(path.join(outbox, "sessions/conversation/runs/run-1/cat.txt"), "utf8"))
      .toContain("Whiskers skim");
    const db = new Database(dbPath);
    const audit = db
      .query("SELECT capability, tool_name, allowed FROM tool_audit_log")
      .get() as { capability: string; tool_name: string; allowed: number };
    expect(audit).toEqual({
      capability: "artifact.write",
      tool_name: "artifact.write",
      allowed: 1,
    });
    db.close();
    artifacts.close();
    runtimeStore.close();
  });
});
