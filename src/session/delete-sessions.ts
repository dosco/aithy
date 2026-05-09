import type { ActiveRunRegistry } from "../agent/active-runs";
import type { BotSession, BotSessionSummary } from "./types";
import type { SessionStateStore } from "./state-store";

interface DeleteCtx {
  sessions: Map<string, BotSession>;
  logicalSessions: Map<string, BotSessionSummary>;
  state?: SessionStateStore;
  activeRuns?: ActiveRunRegistry;
  destroy(conversationId: string): Promise<void>;
}

export async function deleteSessionTree(ctx: DeleteCtx, conversationId: string): Promise<string[]> {
  const ids = descendantSessionIds(ctx, conversationId);
  if (!ids.includes(conversationId)) ids.unshift(conversationId);
  for (const id of ids) ctx.activeRuns?.cancel(id);
  for (const id of ids) {
    await ctx.destroy(id);
    ctx.logicalSessions.delete(id);
    ctx.state?.deleteSession(id);
  }
  return ids;
}

export async function deleteEverySession(ctx: DeleteCtx): Promise<string[]> {
  ctx.activeRuns?.stopAll();
  const ids = new Set<string>();
  for (const summary of ctx.state?.listSessions() ?? []) ids.add(summary.conversationId);
  for (const id of ctx.logicalSessions.keys()) ids.add(id);
  for (const id of ctx.sessions.keys()) ids.add(id);
  for (const id of [...ctx.sessions.keys()]) await ctx.destroy(id);
  ctx.logicalSessions.clear();
  ctx.state?.deleteAllSessions();
  return [...ids];
}

function descendantSessionIds(ctx: DeleteCtx, conversationId: string): string[] {
  const out = [conversationId];
  for (const child of ctx.state?.childSessions(conversationId) ?? []) {
    out.push(...descendantSessionIds(ctx, child.conversationId));
  }
  for (const child of ctx.logicalSessions.values()) {
    if (child.parentSessionId === conversationId) {
      out.push(...descendantSessionIds(ctx, child.conversationId));
    }
  }
  return [...new Set(out)];
}
