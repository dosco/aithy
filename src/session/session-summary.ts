import { createHash } from "node:crypto";
import path from "node:path";
import type { BotSession, BotSessionSummary } from "./types";

export function computeMountName(hostPath: string): string {
  const base = path.basename(hostPath.replace(/\/+$/, "")) || "mount";
  const hash = createHash("sha256").update(hostPath).digest("hex").slice(0, 8);
  const safeBase = base.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safeBase}-${hash}`;
}

export function summaryFromSession(session: BotSession): BotSessionSummary {
  return {
    conversationId: session.conversationId,
    name: session.name,
    nameSource: session.nameSource,
    source: session.source,
    model: session.model,
    systemPrompt: session.systemPrompt,
    parentSessionId: session.parentSessionId,
    parentMessageId: session.parentMessageId,
    tokenTotals: { ...session.tokenTotals },
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    expiresAt: session.expiresAt,
  };
}
