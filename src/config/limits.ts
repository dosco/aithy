export const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 45;
export const SESSION_SWEEP_INTERVAL_MS = 1000 * 60 * 5;
export const DEFAULT_IDLE_PARK_MS = 1000 * 60 * 10;
export const DEFAULT_MAX_LIVE_SANDBOXES = 8;

export const MAX_TOOL_OUTPUT_CHARS = 24_000;
export const MAX_BASH_TIMEOUT_MS = 1000 * 60 * 2;
export const DEFAULT_BASH_TIMEOUT_MS = 1000 * 30;
export const MAX_SANDBOX_INLINE_BYTES = 1024 * 1024 * 2;
export const MAX_CONVERSATION_HISTORY_MESSAGES = 40;
export const MAX_CONVERSATION_HISTORY_TEXT_CHARS = 4_000;

export const WORKSPACE_ROOT_NAME = ".aithy";
export const SANDBOX_OUT_DIR = "/workspace/out";
export const SANDBOX_MOUNTS_DIR = "/workspace/mounts";
