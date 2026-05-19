import type { SessionManager } from "./session-manager";
import type { BotSessionSummary } from "./types";

export const HOME_SESSION_ID = "home";
export const HOME_SESSION_NAME = "Home";

type HomeSessionStore = Pick<SessionManager, "ensureLogicalSession" | "getSummary">;

export function ensureHomeSession(sessions: HomeSessionStore): BotSessionSummary {
  const existing = sessions.getSummary(HOME_SESSION_ID);
  if (existing) return existing;
  return sessions.ensureLogicalSession(HOME_SESSION_ID, {
    name: HOME_SESSION_NAME,
    nameSource: "manual",
  });
}

export function newSpecificSessionId(generateId: () => string = () => crypto.randomUUID()): string {
  let id = generateId();
  while (id === HOME_SESSION_ID) id = generateId();
  return id;
}
