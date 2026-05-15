import { createHash } from "node:crypto";
import type { AppConfig } from "../config/env";
import type { SessionManager } from "../session/session-manager";
import type { AssistantTextMessage, UserMessage } from "../session/types";
import { captureProgramUsage } from "../usage/capture";
import type { SqliteUsageStore } from "../usage/usage-store";
import { createSkillCandidateDrafter, type SkillCandidateDrafter } from "./candidate-drafter";
import { loadCandidateEvidence } from "./candidate-evidence";
import type { SkillCandidateEntry, SqliteSkillCandidateStore } from "./candidate-store";
import type { SqliteSkillPromotionStore } from "./promote-store";
import type { SqliteSkillsStore } from "./skills-store";

export interface SkillPromotionReplyResult {
  handled: boolean;
  user?: UserMessage;
  assistant?: AssistantTextMessage;
}

export async function handleSkillPromotionReply(input: {
  conversationId: string;
  text: string;
  createdAt: Date;
  config?: AppConfig;
  sessions: SessionManager;
  candidates?: SqliteSkillCandidateStore;
  promotions?: SqliteSkillPromotionStore;
  skills: SqliteSkillsStore;
  drafter?: SkillCandidateDrafter;
  usage?: SqliteUsageStore;
  loadEvidence?: (candidate: SkillCandidateEntry) => string;
}): Promise<SkillPromotionReplyResult> {
  const candidate = input.candidates?.pendingBySubSession(input.conversationId);
  if (candidate) return handleCandidateReply({ ...input, candidate });

  const promotions = input.promotions;
  if (!promotions) return { handled: false };
  const promotion = promotions.pendingBySubSession(input.conversationId);
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
    promotions.markAccepted(promotion.signature, finalId);
    assistant = assistantMessage(
      finalId === promotion.draft.id
        ? `Saved "${promotion.draft.name}" to Skills.`
        : `Saved "${promotion.draft.name}" to Skills as \`${finalId}\` because \`${promotion.draft.id}\` already existed.`,
    );
  } else if (isDismiss(normalized)) {
    promotions.markDismissed(promotion.signature);
    assistant = assistantMessage(`Dismissed "${promotion.draft.name}".`);
  } else {
    assistant = assistantMessage(
      "This skill suggestion is waiting for a simple choice. Reply `save`, `accept`, or `yes` to add it to Skills, or `dismiss` / `no` to ignore it.",
    );
  }

  input.sessions.appendMessages(input.conversationId, [user, assistant]);
  return { handled: true, user, assistant };
}

async function handleCandidateReply(input: {
  conversationId: string;
  text: string;
  createdAt: Date;
  config?: AppConfig;
  sessions: SessionManager;
  candidates?: SqliteSkillCandidateStore;
  promotions?: SqliteSkillPromotionStore;
  skills: SqliteSkillsStore;
  drafter?: SkillCandidateDrafter;
  usage?: SqliteUsageStore;
  loadEvidence?: (candidate: SkillCandidateEntry) => string;
  candidate: SkillCandidateEntry;
}): Promise<SkillPromotionReplyResult> {
  const user = userMessage(input.text, input.createdAt);
  const normalized = normalizeReply(input.text);
  let assistant: AssistantTextMessage;

  if (isAccept(normalized)) {
    try {
      const legacy = input.promotions?.pendingBySubSession(input.conversationId);
      if (legacy) {
        const finalId = uniqueSkillId(input.skills, legacy.draft.id, legacy.signature);
        input.skills.upsert({
          id: finalId,
          name: legacy.draft.name,
          description: legacy.draft.description,
          body: legacy.draft.body,
          allowedTools: legacy.draft.allowedTools,
          tags: legacy.draft.tags,
        });
        input.promotions?.markAccepted(legacy.signature, finalId);
        input.candidates?.markAccepted(input.candidate.id, finalId);
        assistant = assistantMessage(
          finalId === legacy.draft.id
            ? `Saved "${legacy.draft.name}" to Skills.`
            : `Saved "${legacy.draft.name}" to Skills as \`${finalId}\` because \`${legacy.draft.id}\` already existed.`,
        );
        input.sessions.appendMessages(input.conversationId, [user, assistant]);
        return { handled: true, user, assistant };
      }
      const drafter = input.drafter ?? createSkillCandidateDrafter(requiredConfig(input.config));
      const evidence = input.loadEvidence
        ? input.loadEvidence(input.candidate)
        : loadCandidateEvidence(requiredConfig(input.config).stateDbPath, input.candidate);
      const draft = await drafter.forward({
        candidate: input.candidate,
        evidence,
        existingSkills: input.skills.getAll(),
      });
      const finalId = uniqueSkillId(input.skills, draft.id, input.candidate.id);
      input.skills.upsert({
        id: finalId,
        name: draft.name,
        description: draft.description,
        body: draft.body,
        allowedTools: draft.allowedTools,
        tags: draft.tags,
      });
      input.candidates?.markAccepted(input.candidate.id, finalId);
      if (input.usage) {
        captureProgramUsage(drafter.program, {
          store: input.usage,
          purpose: "skill.promote",
          sessionId: input.candidate.sourceSessionId,
          runId: input.candidate.id,
        });
      }
      assistant = assistantMessage(
        finalId === draft.id
          ? `Saved "${draft.name}" to Skills.`
          : `Saved "${draft.name}" to Skills as \`${finalId}\` because \`${draft.id}\` already existed.`,
      );
    } catch (error) {
      assistant = assistantMessage(
        `I couldn't create that skill yet: ${error instanceof Error ? error.message : String(error)}. Reply \`dismiss\` to ignore it, or try \`save\` again later.`,
      );
    }
  } else if (isDismiss(normalized)) {
    input.candidates?.markDismissed(input.candidate.id);
    assistant = assistantMessage(`Dismissed "${input.candidate.title}".`);
  } else {
    assistant = assistantMessage(
      "This skill idea is waiting for a simple choice. Reply `save`, `accept`, or `yes` to create a skill, or `dismiss` / `no` to ignore it.",
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

function requiredConfig(config: AppConfig | undefined): AppConfig {
  if (!config) throw new Error("Skill candidate drafting requires runtime config");
  return config;
}
