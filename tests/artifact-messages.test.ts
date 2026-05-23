import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { runMessage } from "../src/agent/run-message";
import { SqliteArtifactStore } from "../src/artifacts/artifact-store";
import type { ChannelMessage } from "../src/channel/types";
import { loadConfig } from "../src/config/env";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("artifact chat messages", () => {
  test("persists artifact publish results before the final assistant text", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-artifact-"));
    const dbPath = path.join(root, "state.db");
    const sessions = sessionsFor(root, dbPath);

    await runMessage(textMessage("publish report"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      agentFactory: (options: any) => ({
        llm: {},
        program: {
          forward: async () => {
            options.onFunctionCall({
              name: "publish",
              qualifiedName: "artifact.publish",
              args: { path: "report.md" },
              result: artifactResult(),
              ok: true,
              kind: "external",
            });
            return { agentResponse: "Here it is." };
          },
        },
      }),
    });

    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "publish report" },
      { role: "assistant", kind: "tool_call", toolName: "artifact.publish" },
      { role: "assistant", kind: "artifact", title: "Report", openUrl: "/api/artifacts/artifact-1" },
      { role: "assistant", kind: "text", content: "Here it is." },
    ]);
    expect(sessionsFor(root, dbPath).getTranscript("conversation")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        kind: "artifact",
        title: "Report",
        sandboxPath: "/outbox/conversation/run-1/report.md",
      }),
    ]));
  });

  test("converts artifact write results into artifact chat messages", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-artifact-write-"));
    const sessions = sessionsFor(root, path.join(root, "state.db"));

    await runMessage(textMessage("write cat.txt"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      agentFactory: (options: any) => ({
        llm: {},
        program: {
          forward: async () => {
            options.onFunctionCall({
              name: "write",
              qualifiedName: "artifact.write",
              args: { path: "cat.txt" },
              result: artifactResult(),
              ok: true,
              kind: "external",
            });
            return { agentResponse: "Done." };
          },
        },
      }),
    });

    expect(sessions.getTranscript("conversation")).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", kind: "artifact", title: "Report" }),
    ]));
  });

  test("reconciles new artifact records when tool callbacks omit results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-artifact-reconcile-"));
    const dbPath = path.join(root, "state.db");
    const sessions = sessionsFor(root, dbPath);
    const artifacts = new SqliteArtifactStore(dbPath, path.join(root, "workspace"), path.join(root, "outbox"));

    await runMessage(textMessage("write dog.txt"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      artifacts,
      agentFactory: (options: any) => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: { artifactContext: string }) => {
            const runOutboxPath = outboxFromContext(input.artifactContext);
            await artifacts.write({
              sessionId: "conversation",
              runId: runIdFromOutbox(runOutboxPath),
              runOutboxPath,
              path: "dog.txt",
              content: "Rain taps on the porch\nA lonely dog watches dusk\nTail low, moonless night\n",
              title: "dog.txt",
            });
            options.onFunctionCall({
              name: "write",
              qualifiedName: "artifact.write",
              args: { path: "dog.txt" },
              kind: "external",
            });
            return { agentResponse: "Done." };
          },
        },
      }),
    });

    expect(sessions.getTranscript("conversation")).toMatchObject([
      { role: "user", content: "write dog.txt" },
      { role: "assistant", kind: "tool_call", toolName: "artifact.write" },
      { role: "assistant", kind: "artifact", title: "dog.txt" },
      { role: "assistant", kind: "text", content: "Done." },
    ]);
    artifacts.close();
  });

  test("reconciles files written directly into the current run outbox", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-artifact-scan-"));
    const dbPath = path.join(root, "state.db");
    const sessions = sessionsFor(root, dbPath);
    const artifacts = new SqliteArtifactStore(dbPath, path.join(root, "workspace"), path.join(root, "outbox"));

    await runMessage(textMessage("write shell.txt"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      artifacts,
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: { artifactContext: string }) => {
            const runOutboxPath = outboxFromContext(input.artifactContext);
            const relative = runOutboxPath.slice("/outbox/".length);
            const file = path.join(root, "outbox", relative, "shell.txt");
            await mkdir(path.dirname(file), { recursive: true });
            await Bun.write(file, "hello from shell");
            return { agentResponse: "Done." };
          },
        },
      }),
    });

    expect(sessions.getTranscript("conversation")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        kind: "artifact",
        title: "shell.txt",
        sandboxPath: expect.stringContaining("/shell.txt"),
      }),
    ]));
    artifacts.close();
  });

  test("carries previous artifact paths through conversation history", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-run-artifact-context-"));
    const dbPath = path.join(root, "state.db");
    const sessions = sessionsFor(root, dbPath);
    const artifacts = new SqliteArtifactStore(dbPath, path.join(root, "workspace"), path.join(root, "outbox"));
    const seenInputs: any[] = [];

    await runMessage(textMessage("write compact.txt"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      artifacts,
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: { artifactContext: string }) => {
            const runOutboxPath = outboxFromContext(input.artifactContext);
            await artifacts.write({
              sessionId: "conversation",
              runId: runIdFromOutbox(runOutboxPath),
              runOutboxPath,
              path: "compact.txt",
              content: "Sunlight warms the stone\nMorning spills through quiet leaves\nGold hums on the air",
              title: "compact.txt",
            });
            return { agentResponse: "Done." };
          },
        },
      }),
    });

    await runMessage(textMessage("do you still have the file"), {
      config: { ...loadConfig(), sandboxProvider: "disabled" },
      events: new EventBus(),
      sandbox: new MockSandboxProvider(),
      sessions,
      artifacts,
      agentFactory: () => ({
        llm: {},
        program: {
          forward: async (_llm: unknown, input: any) => {
            seenInputs.push(input);
            return { agentResponse: "Yes, compact.txt is still available." };
          },
        },
      }),
    });

    expect(seenInputs[0].conversationHistory).toContain("Published artifact: compact.txt");
    expect(seenInputs[0].conversationHistory).toContain("filename=compact.txt");
    expect(seenInputs[0].conversationHistory).toContain("id=");
    expect(seenInputs[0].conversationHistory).toContain("sandboxPath=/outbox/conversation/");
    expect(seenInputs[0].conversationHistory).toContain("openUrl=/api/artifacts/");
    expect(seenInputs[0].artifactContext).not.toContain("Previously published artifacts");
    expect(seenInputs[0].artifactContext).toContain("Recent current-session artifacts:");
    expect(seenInputs[0].artifactContext).toContain("filename=compact.txt");
    expect(seenInputs[0].artifactContext).toContain("sandboxPath=/outbox/conversation/");
    artifacts.close();
  });
});

function artifactResult() {
  return {
    id: "artifact-1",
    sessionId: "conversation",
    runId: "run-1",
    sandboxPath: "/outbox/conversation/run-1/report.md",
    relativePath: "conversation/run-1/report.md",
    title: "Report",
    description: "A generated report",
    filename: "report.md",
    mimeType: "text/markdown; charset=utf-8",
    sizeBytes: 12,
    previewKind: "text",
    textPreview: "# Report",
    createdAt: "2026-04-30T00:00:01.000Z",
    openUrl: "/api/artifacts/artifact-1",
    downloadUrl: "/api/artifacts/artifact-1?download=1",
  };
}

function sessionsFor(root: string, dbPath: string): SessionManager {
  const sandbox = new MockSandboxProvider();
  return new SessionManager({
    sandbox,
    botId: "default",
    workspaceRoot: root,
    outboxRoot: path.join(root, "outbox"),
    events: new EventBus(),
    ttlMs: 1000,
    state: new SqliteSessionStateStore(dbPath),
  });
}

function outboxFromContext(context: string): string {
  const line = context.split("\n").find((item) => item.startsWith("Current run outbox: "));
  if (!line) throw new Error("missing artifact context");
  return line.slice("Current run outbox: ".length);
}

function runIdFromOutbox(outbox: string): string {
  return outbox.split("/").at(-1) ?? "";
}

function textMessage(text: string): ChannelMessage {
  return {
    id: "m1",
    channelId: "channel",
    conversationId: "conversation",
    senderId: "user",
    text,
    createdAt: new Date("2026-04-30T00:00:00Z"),
  };
}
