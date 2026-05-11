import { createHash } from "node:crypto";
import type { SessionManager } from "../session/session-manager";
import type { AssistantTextMessage, UserMessage } from "../session/types";
import type { SqliteSkillPromotionStore } from "./promote-store";
import type { SqliteSkillsStore } from "./skills-store";

export interface SkillPromotionReplyResult {
  handled: boolean;
  user?: UserMessage;
  assistant?: AssistantTextMessage;
}

export function handleSkillPromotionReply(input: {
  conversationId: string;
  text: string;
  createdAt: Date;
  sessions: SessionManager;
  promotions: SqliteSkillPromotionStore;
  skills: SqliteSkillsStore;
}): SkillPromotionReplyResult {
  const promotion = input.promotions.pendingBySubSession(input.conversationId);
  if (!promotion) return { handled: false };

  const user = userMessage(input.text, input.createdAt);
  const normalized = normalizeReply(input.text);
  let assistant: AssistantTextMessage;

  if (isAccept(normalized)) {
    const finalId = uniqueSkillId(input.skills, promotion.draft.id, promotion.signature);
    input.skills.upsert({
      id: finalId,
      name: promotion.draft.name,
      description: promotion.draft.description,
      body: promotion.draft.body,
      allowedTools: promotion.draft.allowedTools,
      tags: promotion.draft.tags,
    });
    input.promotions.markAccepted(promotion.signature, finalId);
    assistant = assistantMessage(
      finalId === promotion.draft.id
        ? `Saved "${promotion.draft.name}" to Skills.`
        : `Saved "${promotion.draft.name}" to Skills as \`${finalId}\` because \`${promotion.draft.id}\` already existed.`,
    );
  } else if (isDismiss(normalized)) {
    input.promotions.markDismissed(promotion.signature);
    assistant = assistantMessage(`Dismissed "${promotion.draft.name}".`);
  } else {
    assistant = assistantMessage(
      "This skill suggestion is waiting for a simple choice. Reply `save`, `accept`, or `yes` to add it to Skills, or `dismiss` / `no` to ignore it.",
    );
  }

  input.sessions.appendMessages(input.conversationId, [user, assistant]);
  return { handled: true, user, assistant };
}

function uniqueSkillId(
  skills: SqliteSkillsStore,
  preferredId: string,
  signature: string,
): string {
  const base = slugify(preferredId) || "promoted-skill";
  if (!skills.get(base)) return base;
  const suffix = createHash("sha256").update(signature).digest("hex").slice(0, 8);
  const withHash = trimForSuffix(base, suffix);
  if (!skills.get(withHash)) return withHash;
  let index = 2;
  while (skills.get(`${trimForSuffix(base, `${suffix}-${index}`)}`)) index += 1;
  return trimForSuffix(base, `${suffix}-${index}`);
}

function trimForSuffix(base: string, suffix: string): string {
  return `${base.slice(0, Math.max(1, 119 - suffix.length))}-${suffix}`;
}

function normalizeReply(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

function isAccept(text: string): boolean {
  return new Set(["yes", "y", "save", "save it", "accept", "accepted", "do it", "please save"]).has(text);
}

function isDismiss(text: string): boolean {
  return new Set(["no", "n", "dismiss", "decline", "skip", "not now", "dont save", "don't save"]).has(text);
}

function userMessage(text: string, createdAt: Date): UserMessage {
  return {
    role: "user",
    content: text,
    createdAt: createdAt.toISOString(),
  };
}

function assistantMessage(text: string): AssistantTextMessage {
  return {
    role: "assistant",
    kind: "text",
    content: text,
    createdAt: new Date().toISOString(),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
