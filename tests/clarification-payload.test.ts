import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { normalizeClarification } from "../src/agent/clarification-payload";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("structured clarification payloads", () => {
  test("normalizes string and object choices to stable label/value pairs", () => {
    expect(normalizeClarification({
      question: "Which one?",
      type: "single_choice",
      choices: ["Alpha", { label: "Beta", value: "b" }, { label: "Gamma" }],
    })).toEqual({
      type: "single_choice",
      choices: [
        { label: "Alpha", value: "Alpha" },
        { label: "Beta", value: "b" },
        { label: "Gamma", value: "Gamma" },
      ],
    });
  });

  test("round-trips clarification metadata through SQLite", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-clarification-"));
    const dbPath = path.join(root, "state.db");
    const store = new SqliteSessionStateStore(dbPath);
    const now = "2026-05-02T12:00:00.000Z";
    store.ensureSession({
      conversationId: "conversation",
      name: "Clarification",
      nameSource: "manual",
      source: "web",
      now,
      expiresAt: new Date("2026-05-02T13:00:00.000Z"),
    });
    store.appendMessages("conversation", [{
      role: "assistant",
      kind: "text",
      content: "Choose",
      clarification: {
        type: "multiple_choice",
        choices: [{ label: "One", value: "1" }],
      },
      createdAt: now,
    }]);
    store.close();

    const reopened = new SqliteSessionStateStore(dbPath);
    expect(reopened.loadSession("conversation")?.messages[0]).toMatchObject({
      content: "Choose",
      clarification: {
        type: "multiple_choice",
        choices: [{ label: "One", value: "1" }],
      },
    });
    reopened.close();
  });
});
