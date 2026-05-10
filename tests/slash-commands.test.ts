import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { ChannelCommand } from "../src/channel/types";
import { handleSlashCommand } from "../src/commands/slash-commands";
import { EventBus } from "../src/events/bus";
import { MockSandboxProvider } from "../src/sandbox/mock-provider";
import { SessionManager } from "../src/session/session-manager";
import { SqliteSessionStateStore } from "../src/session/sqlite-state-store";

describe("handleSlashCommand", () => {
  test("removed legacy web commands are unknown", async () => {
    const sessions = await createSessions();
    sessions.ensureLogicalSession("session-one", { name: "First", nameSource: "manual" });

    for (const text of ["/clear", "/reset", "/rename Project Alpha", "/list", "/sessions"]) {
      expect((await handleSlashCommand(command(text), { sessions })).reply.text)
        .toContain("Unknown command");
    }
    expect(sessions.getSummary("session-one")?.name).toBe("First");
  });

  test("switches by id or quoted name and creates missing sessions", async () => {
    const sessions = await createSessions();
    sessions.ensureLogicalSession("existing", { name: "Named", nameSource: "manual" });

    const byId = await handleSlashCommand(command("/session existing"), { sessions });
    expect(byId.activeConversationId).toBe("existing");

    const byName = await handleSlashCommand(command("/session \"Named\""), { sessions });
    expect(byName.activeConversationId).toBe("existing");

    const createdById = await handleSlashCommand(command("/session new-one"), { sessions });
    expect(createdById.activeConversationId).toBe("new-one");
    expect(sessions.getSummary("new-one")?.name).toBe("New session");

    const createdByName = await handleSlashCommand(command("/session \"Design Notes\""), {
      sessions,
    });
    expect(createdByName.activeConversationId).toBe("design-notes");
    expect(sessions.getSummary("design-notes")?.name).toBe("Design Notes");
  });

  test("prefers unquoted ids and reports ambiguous quoted names", async () => {
    const sessions = await createSessions();
    sessions.ensureLogicalSession("dupe", { name: "dupe", nameSource: "manual" });
    sessions.ensureLogicalSession("other", { name: "dupe", nameSource: "manual" });

    const idResult = await handleSlashCommand(command("/session dupe"), { sessions });
    expect(idResult.activeConversationId).toBe("dupe");

    const nameResult = await handleSlashCommand(command("/session \"dupe\""), { sessions });
    expect(nameResult.reply.text).toContain("Multiple sessions named");
    expect(nameResult.activeConversationId).toBeUndefined();
  });

  test("returns help and unknown command messages", async () => {
    const sessions = await createSessions();
    expect((await handleSlashCommand(command("/help"), { sessions })).reply.text)
      .toContain("/session <id | \"name\">");
    expect((await handleSlashCommand(command("/help"), { sessions })).reply.text)
      .not.toContain("/clear");
    expect((await handleSlashCommand(command("/nope"), { sessions })).reply.text)
      .toContain("Unknown command");
  });
});

async function createSessions(): Promise<SessionManager> {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-commands-"));
  return new SessionManager({
    sandbox: new MockSandboxProvider(),
    botId: "default",
    workspaceRoot: root,
    events: new EventBus(),
    ttlMs: 1000,
    state: new SqliteSessionStateStore(path.join(root, "state.db")),
  });
}

function command(text: string): ChannelCommand {
  return {
    kind: "command",
    id: crypto.randomUUID(),
    channelId: "session-one",
    conversationId: "session-one",
    senderId: "local-user",
    text,
    createdAt: new Date("2026-05-02T12:00:00.000Z"),
  };
}
