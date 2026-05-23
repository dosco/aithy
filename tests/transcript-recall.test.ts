import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";
import { SqliteTranscriptRecallStore } from "../src/retrieval/transcript-recall";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-transcript-recall-"));
  return path.join(dir, "state.db");
}

describe("transcript recall", () => {
  test("finds message text, tool payloads, and artifact metadata but excludes the current turn", async () => {
    const dbPath = await tempDbPath();
    const sessions = new SqliteSessionStateStore(dbPath);
    sessions.ensureSession({
      conversationId: "conversation",
      name: "Recall",
      nameSource: "manual",
      source: "test",
      now: "2026-05-01T00:00:00.000Z",
      expiresAt: new Date("2026-05-01T01:00:00.000Z"),
    });
    sessions.appendMessages("conversation", [
      { role: "user", content: "The important file is src/prompts/SOUL.md", createdAt: "2026-05-01T00:00:01.000Z" },
      {
        role: "assistant",
        kind: "tool_call",
        toolName: "sandbox.bash",
        toolArgs: { command: "sed -n '1,20p' src/prompts/SOUL.md" },
        toolResult: { stdout: "safe responder guidance" },
        createdAt: "2026-05-01T00:00:02.000Z",
      },
      {
        role: "assistant",
        kind: "artifact",
        id: "artifact-1",
        sessionId: "conversation",
        runId: "run-1",
        sandboxPath: "/outbox/sessions/conversation/soul-notes.md",
        relativePath: "soul-notes.md",
        title: "Soul notes",
        description: null,
        filename: "soul-notes.md",
        mimeType: "text/markdown",
        sizeBytes: 12,
        previewKind: "text",
        textPreview: "notes",
        openUrl: "/api/artifacts/artifact-1",
        downloadUrl: "/api/artifacts/artifact-1?download=1",
        createdAt: "2026-05-01T00:00:03.000Z",
      },
      { role: "user", content: "current turn mentions src/prompts/SOUL.md", createdAt: "2026-05-01T00:00:04.000Z" },
    ]);

    const recall = new SqliteTranscriptRecallStore(dbPath);
    const before = recall.searchDetailed(["`src/prompts/SOUL.md`"], {
      limit: 5,
      beforeCreatedAt: "2026-05-01T00:00:04.000Z",
    });
    expect(before.entries.map((entry) => entry.messageId)).not.toContain(4);
    expect(before.entries[0]?.content).toContain("src/prompts/SOUL.md");
    expect(before.entries.some((entry) => entry.content.includes("sandbox.bash"))).toBe(true);
    expect(before.diagnostics.sources[0]).toMatchObject({ source: "transcripts" });

    const artifact = recall.searchDetailed(["soul-notes.md"], {
      limit: 1,
      beforeCreatedAt: "2026-05-01T00:00:04.000Z",
    });
    expect(artifact.entries[0]?.content).toContain("soul-notes.md");
  });
});
