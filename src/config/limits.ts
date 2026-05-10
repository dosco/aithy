export const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 45;
export const SESSION_SWEEP_INTERVAL_MS = 1000 * 60 * 5;
// With one shared VM per bot, the cost of keeping it live is one VM regardless
// of how many conversations exist. So we lean toward "don't park unless the
// user is clearly gone" — covers a coffee/lunch break without a cold resume.
export const DEFAULT_IDLE_PARK_MS = 1000 * 60 * 30;
export const DEFAULT_PARALLEL_AGENTS = 1;
export const MAX_PARALLEL_AGENTS = 8;

export const MAX_TOOL_OUTPUT_CHARS = 24_000;
export const MAX_BASH_TIMEOUT_MS = 1000 * 60 * 2;
export const DEFAULT_BASH_TIMEOUT_MS = 1000 * 30;
export const MAX_SANDBOX_INLINE_BYTES = 1024 * 1024 * 2;
export const MAX_CONVERSATION_HISTORY_MESSAGES = 40;
export const MAX_CONVERSATION_HISTORY_TEXT_CHARS = 4_000;

// If a queued chat hasn't been picked up by a worker within this window, drop it
// (covers process restarts where the UI has already moved on, so we don't replay
// stale messages an hour later).
export const USER_CHAT_QUEUE_STALE_MS = 1000 * 60;
// Per-attempt processing budget for one agent run. Generous so multi-step tool
// calls + LLM latency fit comfortably; the wedged-job stall check kicks in for
// truly stuck workers.
export const USER_CHAT_JOB_TIMEOUT_MS = 1000 * 60 * 10;
