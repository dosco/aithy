// Conservative pre-filter for memory triage. Skip enqueue ONLY for messages
// that are clearly content-free acks ("yes", "thanks", emoji-only). Keep
// ambiguous shorts ("coffee", "tabs") because the user might be answering a
// question with a single noun that's worth remembering.

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

export function isTrivialUserTurn(text: string): boolean {
  const stripped = text
    .normalize("NFKC")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (stripped.length === 0) return true;
  // Pure emoji-only (no letters or digits).
  if (!/\p{L}|\p{N}/u.test(text)) return true;
  // Single ack word, possibly with a couple of spaces.
  if (ACK_WORDS.has(stripped)) return true;
  // Very short ack like "ok!" or "yes!!" with punctuation already stripped.
  if (stripped.length <= 3 && ACK_WORDS.has(stripped)) return true;
  return false;
}
