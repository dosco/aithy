import { describe, expect, test } from "bun:test";
import {
  ensureHomeSession,
  HOME_SESSION_ID,
  HOME_SESSION_NAME,
  newSpecificSessionId,
} from "../src/session/home-session";
import type { BotSessionSummary, SessionNameSource } from "../src/session/types";

describe("home session helpers", () => {
  test("creates Home once with the fixed home id", () => {
    const sessions = new FakeSessions();

    const first = ensureHomeSession(sessions as never);
    const second = ensureHomeSession(sessions as never);

    expect(first.conversationId).toBe(HOME_SESSION_ID);
    expect(first.name).toBe(HOME_SESSION_NAME);
    expect(first.nameSource).toBe("manual");
    expect(second).toEqual(first);
    expect(sessions.ensureCalls).toBe(1);
  });

  test("does not overwrite an existing home session", () => {
    const sessions = new FakeSessions([
      summary(HOME_SESSION_ID, "Existing Home", "generated"),
    ]);

    const home = ensureHomeSession(sessions as never);

    expect(home.name).toBe("Existing Home");
    expect(home.nameSource).toBe("generated");
    expect(sessions.ensureCalls).toBe(0);
  });

  test("explicit new session ids are never home", () => {
    const ids = ["home", "specific-session"];

    expect(newSpecificSessionId(() => ids.shift() ?? "fallback")).toBe("specific-session");
  });
});

class FakeSessions {
  ensureCalls = 0;
  private readonly sessions = new Map<string, BotSessionSummary>();

  constructor(sessions: BotSessionSummary[] = []) {
    for (const session of sessions) this.sessions.set(session.conversationId, session);
  }

  getSummary(conversationId: string): BotSessionSummary | undefined {
    return this.sessions.get(conversationId);
  }

  ensureLogicalSession(
    conversationId: string,
    options: { name?: string; nameSource?: SessionNameSource } = {},
  ): BotSessionSummary {
    this.ensureCalls += 1;
    const created = summary(
      conversationId,
      options.name ?? "New session",
      options.nameSource ?? "generated",
    );
    this.sessions.set(conversationId, created);
    return created;
  }
}

function summary(
  conversationId: string,
  name: string,
  nameSource: SessionNameSource,
): BotSessionSummary {
  const now = "2026-05-18T12:00:00.000Z";
  return {
    conversationId,
    name,
    nameSource,
    source: "test",
    model: null,
    systemPrompt: null,
    parentSessionId: null,
    parentMessageId: null,
    tokenTotals: { input: 0, output: 0, thought: 0, total: 0 },
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date("2026-05-19T12:00:00.000Z"),
  };
}
