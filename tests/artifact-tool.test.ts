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
    await mkdir(path.join(outbox, "conversation/run-1"), { recursive: true });
    await Bun.write(path.join(outbox, "conversation/run-1/note.txt"), "hello");
    const dbPath = path.join(root, "state.db");
    const runtimeStore = new RuntimeStore(dbPath);
    runtimeStore.ensureGrant("artifact.publish", "test grant");
    const artifacts = new SqliteArtifactStore(dbPath, workspace, outbox);
    const tool = createAgentTools({
      session: { conversationId: "conversation" },
      workspacePath: workspace,
      artifacts,
      artifactRunId: "run-1",
      artifactRunOutboxPath: "/outbox/conversation/run-1",
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
      sandboxPath: "/outbox/conversation/run-1/note.txt",
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
      artifactRunOutboxPath: "/outbox/conversation/run-1",
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
      sandboxPath: "/outbox/conversation/run-1/cat.txt",
      relativePath: "conversation/run-1/cat.txt",
      previewKind: "text",
    });
    expect(await readFile(path.join(outbox, "conversation/run-1/cat.txt"), "utf8"))
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

describe("artifact.find tool", () => {
  test("finds prior current-session artifacts by filename and returns URLs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-artifact-find-tool-"));
    const workspace = path.join(root, "workspace");
    const outbox = path.join(root, "outbox");
    const dbPath = path.join(root, "state.db");
    const artifacts = new SqliteArtifactStore(dbPath, workspace, outbox);
    const published = await artifacts.write({
      sessionId: "conversation",
      runId: "run-1",
      runOutboxPath: "/outbox/conversation/run-1",
      path: "reports/quarterly.md",
      content: "# Quarterly\n",
      title: "Quarterly Report",
    });
    await artifacts.write({
      sessionId: "other",
      runId: "run-1",
      runOutboxPath: "/outbox/other/run-1",
      path: "quarterly.md",
      content: "# Other\n",
      title: "Other Quarterly Report",
    });
    const tool = createAgentTools({
      session: { conversationId: "conversation" },
      workspacePath: workspace,
      artifacts,
      artifactRunId: "run-2",
      artifactRunOutboxPath: "/outbox/conversation/run-2",
    } as any, { ...loadConfig(), sandboxProvider: "disabled" })
      .find((item: any) => item.namespace === "artifact" && item.name === "find") as any;

    const result = await tool.func({ query: "quarterly.md", limit: 5 });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      id: published.id,
      title: "Quarterly Report",
      sandboxPath: "/outbox/conversation/run-1/reports/quarterly.md",
      openUrl: `/api/artifacts/${published.id}`,
      available: true,
    });
    artifacts.close();
  });
});
