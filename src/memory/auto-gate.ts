import type { BotMessage } from "../session/types";

// Conservative pre-filter for memory triage. This should be cheap and local:
// it decides whether an LLM triage run is worth batching, not what to write.

const ACK_WORDS = new Set([
  "yes", "yeah", "yep", "yup", "y",
  "no", "nope", "nah", "n",
  "ok", "okay", "k", "kk",
  "sure", "alright", "fine", "cool",
  "thanks", "thank", "thx", "ty", "tysm",
  "np", "ack",
  "lol", "lmao", "haha", "hehe",
  "done", "got it", "gotcha", "noted",
]);

const GREETING_WORDS = new Set([
  "hi", "hey", "hello", "yo", "sup",
  "good morning", "good afternoon", "good evening",
]);

const STABLE_PREFERENCE =
  /\b(i|we)\s+(really\s+|strongly\s+|absolutely\s+)?(like|love|hate|dislike|prefer|enjoy)\b|\b(i'?m|i am|we'?re|we are)\s+into\b|\bmy\s+favou?rite\b/i;
const CURRENT_REACTION =
  /\b(i|we)\s+(really\s+)?(like|love|liked|loved|enjoyed)\s+(this|that|your)\s+(answer|response|reply|joke|idea|suggestion|one|it)\b/i;
const TENTATIVE_INTEREST =
  /\b(i|we)\s+(might|may|could|would like to|want to|am thinking about|i'?m thinking about|am interested in|i'?m interested in|am curious about|i'?m curious about)\s+(try|trying|check|checking|look|looking|learn|learning|explore|exploring|visit|visiting|read|reading|watch|watching|play|playing|use|using|get|getting|make|making|buy|buying)\b/i;
const VAGUE_REFERENCE =
  /\b(i|we)\s+(might|may|could|would like to|want to|am thinking about|i'?m thinking about)\s+(try|check out|look into|do|use|get|make)\s+(it|that|this)\b/i;
const STABLE_FACT_OR_HABIT =
  /\b(my|our)\s+(main|default|primary|usual|preferred)\b|\b(i|we)\s+(usually|always|often|mostly|generally|tend to|use|run|work in|write)\b/i;
const DIRECT_INSTRUCTION = /^(use|prefer|remember|call me)\b/i;
const JOKE_REQUEST = /\b(tell me a joke|make me laugh)\b|^joke$/i;

export interface AutoMemoryGateInput {
  userText: string;
  priorMessages?: readonly BotMessage[];
}

export function shouldQueueAutoMemory(input: AutoMemoryGateInput): boolean {
  const text = input.userText.trim();
  if (isTrivialUserTurn(text)) return false;
  if (isGreeting(text)) return false;
  if (JOKE_REQUEST.test(text)) return false;
  if (CURRENT_REACTION.test(text)) return false;
  if (VAGUE_REFERENCE.test(text)) return false;

  if (STABLE_PREFERENCE.test(text)) return true;
  if (TENTATIVE_INTEREST.test(text)) return true;
  if (STABLE_FACT_OR_HABIT.test(text)) return true;
  if (DIRECT_INSTRUCTION.test(text)) return true;
  if (isShortAnswer(text)) return isPreferenceOrPlanQuestion(lastAssistantText(input.priorMessages));
  return false;
}

export function isTrivialUserTurn(text: string): boolean {
  const stripped = normalizeLoose(text);
  if (stripped.length === 0) return true;
  // Pure emoji-only (no letters or digits).
  if (!/\p{L}|\p{N}/u.test(text)) return true;
  // Single ack word, possibly with a couple of spaces.
  if (ACK_WORDS.has(stripped)) return true;
  // Very short ack like "ok!" or "yes!!" with punctuation already stripped.
  if (stripped.length <= 3 && ACK_WORDS.has(stripped)) return true;
  return false;
}

function isGreeting(text: string): boolean {
  return GREETING_WORDS.has(normalizeLoose(text));
}

function isShortAnswer(text: string): boolean {
  const stripped = normalizeLoose(text);
  if (!stripped) return false;
  const words = stripped.split(" ");
  if (words.length > 3) return false;
  return words.every((word) => /^[\p{L}\p{N}][\p{L}\p{N}'-]*$/u.test(word));
}

function isPreferenceOrPlanQuestion(text: string | undefined): boolean {
  if (!text || !text.includes("?")) return false;
  if (/\b(joke|laugh|funny)\b/i.test(text)) return false;
  return /\b(go-?to|favou?rite|prefer|preference|like|love|hate|want|try|plan|interested|curious|usually|which|what)\b/i.test(text);
}

function lastAssistantText(messages: readonly BotMessage[] | undefined): string | undefined {
  if (!messages) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant" && message.kind === "text") return message.content;
  }
  return undefined;
}

function normalizeLoose(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
